-- Regression: a LIMIT SELL for the entire holding must release its reservation
-- before the reserved-position DELETE guard runs. Disposable PostgreSQL only.
BEGIN;

INSERT INTO auth.users(id)
VALUES ('33333333-3333-4333-8333-333333333333')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.paper_crypto_accounts(
  user_id,currency,starting_cash,cash_balance,reserved_cash,realized_pnl,version
) VALUES (
  '33333333-3333-4333-8333-333333333333','INR',1000000,1000000,0,0,1
);

INSERT INTO public.paper_crypto_positions(
  user_id,symbol,base_asset,quantity,reserved_quantity,
  average_entry_price,cost_basis,realized_pnl
) VALUES (
  '33333333-3333-4333-8333-333333333333','BTCUSDT','BTC',
  0.008,0.008,8000000,64000,0
);

INSERT INTO public.paper_crypto_orders(
  order_id,user_id,idempotency_key,request_fingerprint,symbol,base_asset,
  side,order_type,status,quantity,limit_price,fee,reserved_amount,simulation_only
) VALUES (
  '44444444-4444-4444-8444-444444444444',
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  repeat('a',64),'BTCUSDT','BTC','SELL','LIMIT','PENDING',
  0.008,100000,0,0,true
);

SET ROLE service_role;

SELECT public.fill_paper_crypto_limit_order(
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  101000,80,64.64,
  floor(extract(epoch from clock_timestamp())*1000)::bigint
);

DO $full_exit_check$
DECLARE
  v_status text;
  v_cash numeric(24,8);
  v_realized numeric(24,8);
  v_position_count integer;
  v_ledger_count integer;
BEGIN
  SELECT status INTO v_status FROM public.paper_crypto_orders
   WHERE order_id='44444444-4444-4444-8444-444444444444';
  IF v_status <> 'FILLED' THEN
    RAISE EXCEPTION 'Full-position LIMIT SELL did not fill; status=%',v_status;
  END IF;

  SELECT cash_balance,realized_pnl INTO v_cash,v_realized
    FROM public.paper_crypto_accounts
   WHERE user_id='33333333-3333-4333-8333-333333333333';
  IF v_cash <> 1064575.36 OR v_realized <> 575.36 THEN
    RAISE EXCEPTION 'Unexpected full-exit cash/P&L: cash=%, realized=%',v_cash,v_realized;
  END IF;

  SELECT count(*) INTO v_position_count FROM public.paper_crypto_positions
   WHERE user_id='33333333-3333-4333-8333-333333333333' AND symbol='BTCUSDT';
  IF v_position_count <> 0 THEN
    RAISE EXCEPTION 'Full-position LIMIT SELL left a zero-quantity position row';
  END IF;

  SELECT count(*) INTO v_ledger_count FROM public.paper_crypto_ledger
   WHERE order_id='44444444-4444-4444-8444-444444444444';
  IF v_ledger_count <> 2 THEN
    RAISE EXCEPTION 'Expected SELL and FEE ledger rows, found %',v_ledger_count;
  END IF;
END
$full_exit_check$;

RESET ROLE;
ROLLBACK;
