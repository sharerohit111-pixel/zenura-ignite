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

-- Execute the privileged RPCs as service_role, but keep verification reads
-- outside that role. Do not widen service_role table grants for test visibility.
CREATE TEMP TABLE protective_fill_results (
  case_name text PRIMARY KEY,
  result jsonb NOT NULL
) ON COMMIT DROP;
GRANT INSERT ON pg_temp.protective_fill_results TO service_role;

SET ROLE service_role;
INSERT INTO pg_temp.protective_fill_results(case_name,result)
SELECT 'full', public.execute_paper_equity_protective_fill(
  'a1111111-1111-4111-8111-111111111111',
  md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),
  md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),
  9000, n.now_ms, n.now_ms
)
FROM (SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint AS now_ms) n;

INSERT INTO pg_temp.protective_fill_results(case_name,result)
SELECT 'partial', public.execute_paper_equity_protective_fill(
  'b2222222-2222-4222-8222-222222222222',
  md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),
  md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),
  9000, n.now_ms, n.now_ms
)
FROM (SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint AS now_ms) n;
RESET ROLE;

DO $protective_reservation_fill_regression$
DECLARE
  v_full jsonb;
  v_partial jsonb;
  v_cash bigint;
  v_realized bigint;
  v_quantity integer;
  v_reserved integer;
  v_cost bigint;
BEGIN
  SELECT result INTO v_full FROM pg_temp.protective_fill_results WHERE case_name='full';
  SELECT result INTO v_partial FROM pg_temp.protective_fill_results WHERE case_name='partial';

  IF v_full->>'status'<>'FILLED' THEN
    RAISE EXCEPTION 'Fully reserved protective exit did not fill: %',v_full;
  END IF;
  IF EXISTS(SELECT 1 FROM public.paper_equity_positions
     WHERE user_id='a1111111-1111-4111-8111-111111111111'
       AND product='DELIVERY' AND instrument_key='BSE_EQ|INE002A01018') THEN
    RAISE EXCEPTION 'Fully closed position was not removed';
  END IF;
  IF (SELECT status FROM public.paper_protective_orders
       WHERE order_id='a1111111-1111-4111-8111-111111111111')<>'FILLED' THEN
    RAISE EXCEPTION 'Full-position protective order did not reach FILLED';
  END IF;
  SELECT cash_paise,realized_pnl_paise INTO v_cash,v_realized
    FROM public.paper_accounts
   WHERE user_id='a1111111-1111-4111-8111-111111111111';
  IF v_cash<>100000000+(v_full->>'cash_delta_paise')::bigint
     OR v_realized<>(v_full->>'realized_pnl_paise')::bigint THEN
    RAISE EXCEPTION 'Full-position account cash/P&L did not reconcile';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.paper_orders
      WHERE order_id=v_full->>'execution_order_id'
        AND charges_paise=(v_full->>'charges_paise')::bigint
        AND cash_delta_paise=(v_full->>'cash_delta_paise')::bigint
        AND realized_pnl_paise=(v_full->>'realized_pnl_paise')::bigint) THEN
    RAISE EXCEPTION 'Full-position canonical execution record is incomplete';
  END IF;

  IF v_partial->>'status'<>'FILLED' THEN
    RAISE EXCEPTION 'Protective fill with other reserved shares did not fill: %',v_partial;
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
  IF v_cash<>100000000+(v_partial->>'cash_delta_paise')::bigint
     OR v_realized<>(v_partial->>'realized_pnl_paise')::bigint THEN
    RAISE EXCEPTION 'Partial protective account cash/P&L did not reconcile';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.paper_orders
      WHERE order_id=v_partial->>'execution_order_id'
        AND charges_paise=(v_partial->>'charges_paise')::bigint
        AND cash_delta_paise=(v_partial->>'cash_delta_paise')::bigint
        AND realized_pnl_paise=(v_partial->>'realized_pnl_paise')::bigint) THEN
    RAISE EXCEPTION 'Partial protective canonical execution record is incomplete';
  END IF;
END
$protective_reservation_fill_regression$;

ROLLBACK;