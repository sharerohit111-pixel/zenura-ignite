-- Protective exits reserve equity shares against both MARKET and LIMIT SELL paths.
-- Runs only in the disposable PostgreSQL CI database.
-- User-facing protective creation is tested under authenticated; order transaction
-- RPCs are intentionally service_role-only and are tested under service_role.

INSERT INTO auth.users(id) VALUES ('91919191-9191-4919-8919-919191919191') ON CONFLICT DO NOTHING;

SET ROLE service_role;
SELECT public.initialize_paper_trading_account('91919191-9191-4919-8919-919191919191');
RESET ROLE;

INSERT INTO public.paper_equity_positions(
  user_id,product,instrument_key,trading_symbol,exchange,quantity,
  average_price_paise,cost_basis_paise,reserved_quantity
) VALUES (
  '91919191-9191-4919-8919-919191919191','DELIVERY',
  'NSE_EQ|PROTECTIVE_RESERVE_GUARD','PROTECTIVE_RESERVE_GUARD','NSE',
  10,10000,100000,0
);

SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"91919191-9191-4919-8919-919191919191","role":"authenticated"}',
  false
);

DO $protective_create_guard$
DECLARE
  v_result jsonb;
  v_qty integer;
  v_reserved integer;
BEGIN
  v_result := public.create_paper_equity_protective_order(
    '92929292-9292-4929-8929-929292929292',
    '91919191-9191-4919-8919-919191919191',
    'NSE_EQ|PROTECTIVE_RESERVE_GUARD','DELIVERY','STOP_LOSS',9000,4
  );
  IF v_result->'order'->>'status' <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Protective exit fixture was not created';
  END IF;
  SELECT quantity,reserved_quantity INTO v_qty,v_reserved
    FROM public.paper_equity_positions
   WHERE user_id='91919191-9191-4919-8919-919191919191'
     AND product='DELIVERY'
     AND instrument_key='NSE_EQ|PROTECTIVE_RESERVE_GUARD';
  IF v_qty<>10 OR v_reserved<>4 THEN
    RAISE EXCEPTION 'Protective exit did not reserve its four shares';
  END IF;
END
$protective_create_guard$;
RESET ROLE;

-- The trading RPCs are not executable by authenticated clients. Exercise the
-- server-side transaction boundary using the service role, as the gateway does.
SET ROLE service_role;
DO $protective_reserve_guard$
DECLARE
  v_qty integer;
  v_reserved integer;
BEGIN
  BEGIN
    PERFORM public.execute_paper_market_order(
      '91919191-9191-4919-8919-919191919191',
      md5('protective-reservation-market-sell')||md5('protective-reservation-market-sell-unique'),
      '93939393-9393-4939-8939-939393939393',
      md5('protective-reservation-market-fingerprint')||md5('protective-reservation-market-fingerprint-unique'),
      'NSE_EQ|PROTECTIVE_RESERVE_GUARD','PROTECTIVE_RESERVE_GUARD','NSE',
      'SELL','DELIVERY',7,11000,
      floor(extract(epoch from clock_timestamp())*1000)::bigint,0
    );
    RAISE EXCEPTION 'MARKET SELL consumed shares reserved by a protective exit';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    PERFORM public.submit_paper_limit_order(
      '91919191-9191-4919-8919-919191919191',
      md5('protective-reservation-limit-sell')||md5('protective-reservation-limit-sell-unique'),
      '94949494-9494-4949-8949-949494949494',
      md5('protective-reservation-limit-fingerprint')||md5('protective-reservation-limit-fingerprint-unique'),
      'NSE_EQ|PROTECTIVE_RESERVE_GUARD','PROTECTIVE_RESERVE_GUARD','NSE',
      'SELL',7,11000
    );
    RAISE EXCEPTION 'LIMIT SELL consumed shares reserved by a protective exit';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

END
$protective_reserve_guard$;
RESET ROLE;

DO $protective_reserve_assertions$
DECLARE
  v_qty integer;
  v_reserved integer;
BEGIN
  SELECT quantity,reserved_quantity INTO v_qty,v_reserved
    FROM public.paper_equity_positions
   WHERE user_id='91919191-9191-4919-8919-919191919191'
     AND product='DELIVERY'
     AND instrument_key='NSE_EQ|PROTECTIVE_RESERVE_GUARD';
  IF v_qty<>10 OR v_reserved<>4 THEN
    RAISE EXCEPTION 'Rejected SELL requests changed the protective share reservation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.paper_orders
      WHERE order_id IN (
        md5('protective-reservation-market-sell')||md5('protective-reservation-market-sell-unique'),
        md5('protective-reservation-limit-sell')||md5('protective-reservation-limit-sell-unique')
      )) THEN
    RAISE EXCEPTION 'Rejected SELL request left an order row behind';
  END IF;
END
$protective_reserve_assertions$;

DELETE FROM public.paper_protective_orders
 WHERE order_id='92929292-9292-4929-8929-929292929292';
DELETE FROM public.paper_equity_positions
 WHERE user_id='91919191-9191-4919-8919-919191919191'
   AND product='DELIVERY'
   AND instrument_key='NSE_EQ|PROTECTIVE_RESERVE_GUARD';
DELETE FROM public.paper_accounts
 WHERE user_id='91919191-9191-4919-8919-919191919191';
