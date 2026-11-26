-- BSE protective SELL must use the same fee-aware net settlement as MARKET orders.
BEGIN;
INSERT INTO auth.users(id)
VALUES ('cdcdcdcd-abcd-4dcd-8dcd-cdcdcdcdcdcd')
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
SELECT public.initialize_paper_trading_account('cdcdcdcd-abcd-4dcd-8dcd-cdcdcdcdcdcd');
RESET ROLE;

UPDATE public.paper_accounts
   SET starting_cash_paise=100000000,cash_paise=100000000,
       reserved_cash_paise=0,reserved_margin_paise=0,
       realized_pnl_paise=0,delivery_realized_pnl_paise=0,
       intraday_realized_pnl_paise=0,version=1
 WHERE user_id='cdcdcdcd-abcd-4dcd-8dcd-cdcdcdcdcdcd';

INSERT INTO public.paper_equity_positions(
  user_id,product,instrument_key,trading_symbol,exchange,quantity,
  average_price_paise,cost_basis_paise,reserved_quantity
) VALUES (
  'cdcdcdcd-abcd-4dcd-8dcd-cdcdcdcdcdcd','DELIVERY',
  'BSE_EQ|INE002A01018','RELIANCE','BSE',10,8000,80000,4
);

INSERT INTO public.paper_protective_orders(
  order_id,user_id,asset_class,instrument_key,product,side,
  trigger_type,trigger_direction,trigger_price_paise,quantity,status
) VALUES (
  'cdcdcdcd-abcd-4dcd-8dcd-cdcdcdcdcdcd',
  'cdcdcdcd-abcd-4dcd-8dcd-cdcdcdcdcdcd','EQUITY',
  'BSE_EQ|INE002A01018','DELIVERY','SELL',
  'STOP_LOSS','AT_OR_BELOW',10000,4,'ACTIVE'
);

SET ROLE service_role;
DO $bse_protective_fill$
DECLARE
  v_now bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result jsonb;
  v_execution_id text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
BEGIN
  v_result:=public.execute_paper_equity_protective_fill(
    'cdcdcdcd-abcd-4dcd-8dcd-cdcdcdcdcdcd',
    v_execution_id,repeat('d',64),9000,v_now,v_now
  );
  IF v_result->>'status'<>'FILLED'
     OR (v_result->>'charges_paise')::bigint<>4757
     OR (v_result->>'cash_delta_paise')::bigint<>31243
     OR (v_result->>'realized_pnl_paise')::bigint<>-757 THEN
    RAISE EXCEPTION 'BSE protective SELL did not apply BSE fee-aware net settlement: %',v_result;
  END IF;
END
$bse_protective_fill$;
RESET ROLE;

DO $bse_protective_assertions$
DECLARE
  v_order public.paper_orders%rowtype;
BEGIN
  SELECT * INTO v_order FROM public.paper_orders
   WHERE request_fingerprint=repeat('d',64);
  IF NOT FOUND OR v_order.exchange<>'BSE'
     OR v_order.charges_paise<>4757
     OR v_order.cash_delta_paise<>31243
     OR v_order.realized_pnl_paise<>-757
     OR v_order.charges_breakdown->>'exchange'<>'BSE' THEN
    RAISE EXCEPTION 'BSE protective fill did not persist canonical fee-aware order history';
  END IF;
  IF (SELECT cash_paise FROM public.paper_accounts
      WHERE user_id='cdcdcdcd-abcd-4dcd-8dcd-cdcdcdcdcdcd')<>100031243
     OR (SELECT realized_pnl_paise FROM public.paper_accounts
      WHERE user_id='cdcdcdcd-abcd-4dcd-8dcd-cdcdcdcdcdcd')<>-757 THEN
    RAISE EXCEPTION 'BSE protective fill did not reconcile account cash and realized P&L';
  END IF;
END
$bse_protective_assertions$;
ROLLBACK;
