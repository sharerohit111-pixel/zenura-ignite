-- Regression: MARKET SELL must never consume Crypto quantity reserved by a pending LIMIT SELL.
-- Disposable PostgreSQL only; validates both the rejection boundary and valid unreserved sale.
BEGIN;

INSERT INTO auth.users(id)
VALUES ('66666666-6666-4666-8666-666666666666')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.paper_crypto_accounts(
  user_id,currency,starting_cash,cash_balance,reserved_cash,realized_pnl,version
) VALUES (
  '66666666-6666-4666-8666-666666666666','INR',1000000,1000000,0,0,1
);

INSERT INTO public.paper_crypto_positions(
  user_id,symbol,base_asset,quantity,reserved_quantity,
  average_entry_price,cost_basis,realized_pnl
) VALUES (
  '66666666-6666-4666-8666-666666666666','BTCUSDT','BTC',
  0.010,0.006,8000000,80000,0
);

SET ROLE service_role;

DO $reserved_market_sell$
DECLARE
  v_rejected boolean := false;
  v_now_ms bigint := floor(extract(epoch from clock_timestamp())*1000)::bigint;
BEGIN
  BEGIN
    PERFORM public.execute_paper_crypto_market_order(
      '66666666-6666-4666-8666-666666666666',
      '77777777-7777-4777-8777-777777777771',
      '88888888-8888-4888-8888-888888888881',
      repeat('b',64),'BTCUSDT','BTC','SELL',
      0.005,100000,80,40,v_now_ms
    );
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'MARKET SELL consumed quantity reserved by a pending LIMIT SELL';
  END IF;
END
$reserved_market_sell$;

SELECT public.execute_paper_crypto_market_order(
  '66666666-6666-4666-8666-666666666666',
  '77777777-7777-4777-8777-777777777772',
  '88888888-8888-4888-8888-888888888882',
  repeat('c',64),'BTCUSDT','BTC','SELL',
  0.004,100000,80,32,
  floor(extract(epoch from clock_timestamp())*1000)::bigint
);

DO $unreserved_market_sell$
DECLARE
  v_quantity numeric(30,12);
  v_reserved numeric(30,12);
  v_cash numeric(24,8);
  v_status text;
BEGIN
  SELECT quantity,reserved_quantity INTO v_quantity,v_reserved
    FROM public.paper_crypto_positions
   WHERE user_id='66666666-6666-4666-8666-666666666666' AND symbol='BTCUSDT';
  IF v_quantity<>0.006 OR v_reserved<>0.006 THEN
    RAISE EXCEPTION 'Valid unreserved MARKET SELL changed reserved position incorrectly: quantity=%, reserved=%',v_quantity,v_reserved;
  END IF;

  SELECT cash_balance INTO v_cash FROM public.paper_crypto_accounts
   WHERE user_id='66666666-6666-4666-8666-666666666666';
  IF v_cash<>1031968 THEN
    RAISE EXCEPTION 'Unexpected cash balance after valid MARKET SELL: %',v_cash;
  END IF;

  SELECT status INTO v_status FROM public.paper_crypto_orders
   WHERE order_id='77777777-7777-4777-8777-777777777772';
  IF v_status<>'FILLED' THEN
    RAISE EXCEPTION 'Valid unreserved MARKET SELL did not fill: %',v_status;
  END IF;
END
$unreserved_market_sell$;

RESET ROLE;
ROLLBACK;
