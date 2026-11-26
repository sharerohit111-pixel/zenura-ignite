-- Regression: a later FX move must not let one LIMIT BUY consume another order's reservation.
-- Disposable PostgreSQL only.
BEGIN;
INSERT INTO auth.users(id) VALUES ('21212121-2121-4212-8212-212121212121') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.paper_crypto_accounts(user_id,currency,starting_cash,cash_balance,reserved_cash,realized_pnl,version)
VALUES ('21212121-2121-4212-8212-212121212121','INR',1000000,1000000,0,0,1);
SET ROLE service_role;
SELECT public.create_paper_crypto_limit_order(
 '21212121-2121-4212-8212-212121212121','23232323-2323-4232-8232-232323232323',
 '24242424-2424-4424-8424-242424242424',repeat('c',64),'BTCUSDT','BTC','BUY',0.001,80000,80,6.4);
DO $reject_fx_increase$
BEGIN
  BEGIN
    PERFORM public.fill_paper_crypto_limit_order(
      '21212121-2121-4212-8212-212121212121','23232323-2323-4232-8232-232323232323',
      80000,100,8,floor(extract(epoch from clock_timestamp())*1000)::bigint);
    RAISE EXCEPTION 'Expected FX-increased fill to be rejected';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$reject_fx_increase$;
DO $reservation_unchanged$
DECLARE v_cash numeric(24,8); v_reserved numeric(24,8); v_status text; v_ledger integer;
BEGIN
 SELECT cash_balance,reserved_cash INTO v_cash,v_reserved FROM public.paper_crypto_accounts
  WHERE user_id='21212121-2121-4212-8212-212121212121';
 SELECT status INTO v_status FROM public.paper_crypto_orders WHERE order_id='23232323-2323-4232-8232-232323232323';
 SELECT count(*) INTO v_ledger FROM public.paper_crypto_ledger WHERE order_id='23232323-2323-4232-8232-232323232323';
 IF v_cash<>1000000 OR v_reserved<>6406.4 OR v_status<>'PENDING' OR v_ledger<>0 THEN
  RAISE EXCEPTION 'FX guard mutated state: cash=%, reserved=%, status=%, ledger=%',v_cash,v_reserved,v_status,v_ledger;
 END IF;
END
$reservation_unchanged$;
RESET ROLE;
ROLLBACK;
