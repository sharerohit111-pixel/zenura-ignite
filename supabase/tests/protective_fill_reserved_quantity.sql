-- Regression coverage for creation-time Equity protective share reservations.
-- Runs in the disposable PostgreSQL migration workflow and rolls back all fixtures.
BEGIN;

INSERT INTO auth.users(id)
VALUES
 ('a1111111-1111-4111-8111-111111111111'),
 ('b2222222-2222-4222-8222-222222222222')
ON CONFLICT(id) DO NOTHING;

SELECT public.import_bse_equity_fee_master(
  (now() at time zone 'Asia/Kolkata')::date,
  repeat('a',64),
  'https://www.bseindia.com/',
  jsonb_build_array(jsonb_build_object(
    'scrip_code','500325','instrument_code','RELIANCE','group_name','A',
    'scrip_name','RELIANCE INDUSTRIES LIMITED','isin','INE002A01018',
    'exclusive_flag','N','status','A','instrument_type','E'
  ))
);

SET ROLE service_role;
SELECT public.initialize_paper_trading_account('a1111111-1111-4111-8111-111111111111');
SELECT public.initialize_paper_trading_account('b2222222-2222-4222-8222-222222222222');
RESET ROLE;

UPDATE public.paper_accounts
   SET starting_cash_paise=100000000,cash_paise=100000000,
       reserved_cash_paise=0,reserved_margin_paise=0,realized_pnl_paise=0,
       delivery_realized_pnl_paise=0,intraday_realized_pnl_paise=0,version=1
 WHERE user_id IN (
   'a1111111-1111-4111-8111-111111111111',
   'b2222222-2222-4222-8222-222222222222'
 );

-- Case 1: all five owned shares are reserved by the protective exit.
INSERT INTO public.paper_equity_positions(
  user_id,product,instrument_key,trading_symbol,exchange,quantity,
  average_price_paise,cost_basis_paise,reserved_quantity
) VALUES (
  'a1111111-1111-4111-8111-111111111111','DELIVERY',
  'BSE_EQ|INE002A01018','RELIANCE','BSE',5,10000,50000,5
);
INSERT INTO public.paper_protective_orders(
  order_id,user_id,asset_class,instrument_key,product,side,
  trigger_type,trigger_direction,trigger_price_paise,quantity,status
) VALUES (
  'a1111111-1111-4111-8111-111111111111',
  'a1111111-1111-4111-8111-111111111111','EQUITY',
  'BSE_EQ|INE002A01018','DELIVERY','SELL',
  'STOP_LOSS','AT_OR_BELOW',10000,5,'ACTIVE'
);

-- Case 2: four shares belong to the protective reservation; six other shares
-- remain reserved by a separate pending SELL reservation. A protective fill
-- must consume only its four shares and preserve the remaining six reservations.
INSERT INTO public.paper_equity_positions(
  user_id,product,instrument_key,trading_symbol,exchange,quantity,
  average_price_paise,cost_basis_paise,reserved_quantity
) VALUES (
  'b2222222-2222-4222-8222-222222222222','DELIVERY',
  'BSE_EQ|INE002A01018','RELIANCE','BSE',10,10000,100000,10
);
INSERT INTO public.paper_protective_orders(
  order_id,user_id,asset_class,instrument_key,product,side,
  trigger_type,trigger_direction,trigger_price_paise,quantity,status
) VALUES (
  'b2222222-2222-4222-8222-222222222222',
  'b2222222-2222-4222-8222-222222222222','EQUITY',
  'BSE_EQ|INE002A01018','DELIVERY','SELL',
  'STOP_LOSS','AT_OR_BELOW',10000,4,'ACTIVE'
);

SET ROLE service_role;
DO $protective_reservation_fill_regression$
DECLARE
  v_now bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_full jsonb;
  v_partial jsonb;
  v_full_execution_id text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
  v_full_fingerprint text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
  v_partial_execution_id text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
  v_partial_fingerprint text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
BEGIN
  -- Keep privileged execution calls inside service_role. Do not read protected
  -- tables here: the RPC boundary intentionally withholds direct table access.
  v_full:=public.execute_paper_equity_protective_fill(
    'a1111111-1111-4111-8111-111111111111',
    v_full_execution_id,v_full_fingerprint,9000,v_now,v_now
  );
  IF v_full->>'status'<>'FILLED' THEN
    RAISE EXCEPTION 'Fully reserved protective exit did not fill: %',v_full;
  END IF;

  v_partial:=public.execute_paper_equity_protective_fill(
    'b2222222-2222-4222-8222-222222222222',
    v_partial_execution_id,v_partial_fingerprint,9000,v_now,v_now
  );
  IF v_partial->>'status'<>'FILLED' THEN
    RAISE EXCEPTION 'Protective fill with other reserved shares did not fill: %',v_partial;
  END IF;
END
$protective_reservation_fill_regression$;
RESET ROLE;

-- Assert persisted accounting as the disposable migration-test owner, after
-- leaving service_role. This tests the privilege boundary rather than bypassing it.
DO $protective_reservation_fill_assertions$
DECLARE
  v_full_order public.paper_orders%rowtype;
  v_partial_order public.paper_orders%rowtype;
  v_quantity integer;
  v_reserved integer;
  v_cost bigint;
  v_cash bigint;
  v_realized bigint;
BEGIN
  SELECT * INTO v_full_order FROM public.paper_orders
   WHERE user_id='a1111111-1111-4111-8111-111111111111'
     AND instrument_key='BSE_EQ|INE002A01018' AND status='FILLED'
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Full-position canonical execution record is missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.paper_equity_positions
     WHERE user_id='a1111111-1111-4111-8111-111111111111'
       AND product='DELIVERY' AND instrument_key='BSE_EQ|INE002A01018') IS FALSE THEN
    -- Full close must remove the position.
    NULL;
  ELSE
    RAISE EXCEPTION 'Fully closed position was not removed';
  END IF;
  IF (SELECT status FROM public.paper_protective_orders
       WHERE order_id='a1111111-1111-4111-8111-111111111111')<>'FILLED' THEN
    RAISE EXCEPTION 'Full-position protective order did not reach FILLED';
  END IF;
  SELECT cash_paise,realized_pnl_paise INTO v_cash,v_realized
    FROM public.paper_accounts
   WHERE user_id='a1111111-1111-4111-8111-111111111111';
  IF v_cash<>100000000+v_full_order.cash_delta_paise
     OR v_realized<>v_full_order.realized_pnl_paise THEN
    RAISE EXCEPTION 'Full-position account cash/P&L did not reconcile';
  END IF;
  IF v_full_order.charges_paise<0
     OR v_full_order.cash_delta_paise<=0
     OR v_full_order.realized_pnl_paise IS NULL THEN
    RAISE EXCEPTION 'Full-position canonical execution accounting fields are invalid';
  END IF;

  SELECT * INTO v_partial_order FROM public.paper_orders
   WHERE user_id='b2222222-2222-4222-8222-222222222222'
     AND instrument_key='BSE_EQ|INE002A01018' AND status='FILLED'
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partial protective canonical execution record is missing';
  END IF;
  SELECT quantity,reserved_quantity,cost_basis_paise
    INTO v_quantity,v_reserved,v_cost
    FROM public.paper_equity_positions
   WHERE user_id='b2222222-2222-4222-8222-222222222222'
     AND product='DELIVERY' AND instrument_key='BSE_EQ|INE002A01018';
  IF v_quantity<>6 OR v_reserved<>6 OR v_cost<>60000 THEN
    RAISE EXCEPTION 'Protective fill failed to preserve other reservations/cost basis: qty %, reserved %, cost %',
      v_quantity,v_reserved,v_cost;
  END IF;
  SELECT cash_paise,realized_pnl_paise INTO v_cash,v_realized
    FROM public.paper_accounts
   WHERE user_id='b2222222-2222-4222-8222-222222222222';
  IF v_cash<>100000000+v_partial_order.cash_delta_paise
     OR v_realized<>v_partial_order.realized_pnl_paise THEN
    RAISE EXCEPTION 'Partial protective account cash/P&L did not reconcile';
  END IF;
  IF v_partial_order.charges_paise<0
     OR v_partial_order.cash_delta_paise<=0
     OR v_partial_order.realized_pnl_paise IS NULL THEN
    RAISE EXCEPTION 'Partial protective canonical execution accounting fields are invalid';
  END IF;
  IF (SELECT status FROM public.paper_protective_orders
       WHERE order_id='b2222222-2222-4222-8222-222222222222')<>'FILLED' THEN
    RAISE EXCEPTION 'Partial protective order did not reach FILLED';
  END IF;
END
$protective_reservation_fill_assertions$;
RESET ROLE;

ROLLBACK;
