-- Regression: multiple LIMIT BUY reservations, cancellation release and better-price fill accounting.
-- Disposable PostgreSQL only.
BEGIN;

INSERT INTO auth.users(id)
VALUES ('12121212-1212-4212-8212-121212121212')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.paper_crypto_accounts(
 user_id,currency,starting_cash,cash_balance,reserved_cash,realized_pnl,version
) VALUES (
 '12121212-1212-4212-8212-121212121212','INR',1000000,1000000,0,0,1
);

SET ROLE service_role;

-- First BUY reserves ₹6,406.40 (₹6,400 gross + ₹6.40 fee).
SELECT public.create_paper_crypto_limit_order(
 '12121212-1212-4212-8212-121212121212',
 '13131313-1313-4313-8313-131313131311',
 '14141414-1414-4414-8414-141414141411',
 repeat('a',64),'BTCUSDT','BTC','BUY',0.001,80000,80,6.4
);

-- Second BUY reserves ₹14,414.40 (₹14,400 gross + ₹14.40 fee).
SELECT public.create_paper_crypto_limit_order(
 '12121212-1212-4212-8212-121212121212',
 '13131313-1313-4313-8313-131313131312',
 '14141414-1414-4414-8414-141414141412',
 repeat('b',64),'BTCUSDT','BTC','BUY',0.002,90000,80,14.4
);

DO $both_reservations$
DECLARE v_reserved numeric(24,8);
BEGIN
 SELECT reserved_cash INTO v_reserved FROM public.paper_crypto_accounts
  WHERE user_id='12121212-1212-4212-8212-121212121212';
 IF v_reserved<>20820.8 THEN
   RAISE EXCEPTION 'Expected combined BUY reservations 20820.8, found %',v_reserved;
 END IF;
END
$both_reservations$;

SELECT public.cancel_paper_crypto_limit_order(
 '12121212-1212-4212-8212-121212121212',
 '13131313-1313-4313-8313-131313131311'
);

DO $cancel_release$
DECLARE v_reserved numeric(24,8); v_status text;
BEGIN
 SELECT reserved_cash INTO v_reserved FROM public.paper_crypto_accounts
  WHERE user_id='12121212-1212-4212-8212-121212121212';
 SELECT status INTO v_status FROM public.paper_crypto_orders
  WHERE order_id='13131313-1313-4313-8313-131313131311';
 IF v_reserved<>14414.4 OR v_status<>'CANCELLED' THEN
   RAISE EXCEPTION 'Cancel did not release exactly one BUY reservation: reserved=%, status=%',v_reserved,v_status;
 END IF;
END
$cancel_release$;

-- Fill the remaining order at 85,000 USDT, better than its 90,000 limit.
SELECT public.fill_paper_crypto_limit_order(
 '12121212-1212-4212-8212-121212121212',
 '13131313-1313-4313-8313-131313131312',
 85000,80,13.6,
 floor(extract(epoch from clock_timestamp())*1000)::bigint
);

-- Replay must not debit cash or append duplicate ledger entries.
SELECT public.fill_paper_crypto_limit_order(
 '12121212-1212-4212-8212-121212121212',
 '13131313-1313-4313-8313-131313131312',
 85000,80,13.6,
 floor(extract(epoch from clock_timestamp())*1000)::bigint
);

DO $final_buy_accounting$
DECLARE
 v_cash numeric(24,8); v_reserved numeric(24,8);
 v_qty numeric(30,12); v_cost numeric(24,8);
 v_order_count integer; v_ledger_count integer; v_status text;
BEGIN
 SELECT cash_balance,reserved_cash INTO v_cash,v_reserved FROM public.paper_crypto_accounts
  WHERE user_id='12121212-1212-4212-8212-121212121212';
 SELECT quantity,cost_basis INTO v_qty,v_cost FROM public.paper_crypto_positions
  WHERE user_id='12121212-1212-4212-8212-121212121212' AND symbol='BTCUSDT';
 SELECT count(*) INTO v_order_count FROM public.paper_crypto_orders
  WHERE user_id='12121212-1212-4212-8212-121212121212' AND status IN ('FILLED','CANCELLED');
 SELECT count(*) INTO v_ledger_count FROM public.paper_crypto_ledger
  WHERE user_id='12121212-1212-4212-8212-121212121212';
 SELECT status INTO v_status FROM public.paper_crypto_orders
  WHERE order_id='13131313-1313-4313-8313-131313131312';

 IF v_cash<>986386.4 OR v_reserved<>0 OR v_qty<>0.002 OR v_cost<>13613.6
    OR v_order_count<>2 OR v_ledger_count<>2 OR v_status<>'FILLED' THEN
   RAISE EXCEPTION 'Unexpected LIMIT BUY result: cash=%, reserved=%, qty=%, cost=%, orders=%, ledger=%, status=%',
    v_cash,v_reserved,v_qty,v_cost,v_order_count,v_ledger_count,v_status;
 END IF;
END
$final_buy_accounting$;

RESET ROLE;
ROLLBACK;
