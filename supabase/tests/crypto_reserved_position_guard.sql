-- Regression: deleting a crypto position must not orphan pending LIMIT SELL reservations.
-- Disposable PostgreSQL regression fixture; no production data is touched.
BEGIN;
INSERT INTO auth.users(id) VALUES ('33333333-3333-4333-8333-333333333333') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.paper_crypto_accounts(user_id,currency,starting_cash,cash_balance,reserved_cash,realized_pnl,version)
VALUES ('33333333-3333-4333-8333-333333333333','INR',1000000,1000000,0,0,1)
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.paper_crypto_positions(user_id,symbol,base_asset,quantity,reserved_quantity,average_entry_price,cost_basis,realized_pnl)
VALUES ('33333333-3333-4333-8333-333333333333','BTCUSDT','BTC',0.008,0.008,8000000,64000,0)
ON CONFLICT (user_id,symbol) DO UPDATE SET quantity=0.008,reserved_quantity=0.008,average_entry_price=8000000,cost_basis=64000;

SET ROLE service_role;

UPDATE public.paper_crypto_positions
   SET reserved_quantity = 0.003
 WHERE user_id = '33333333-3333-4333-8333-333333333333'
   AND symbol = 'BTCUSDT';

DO $reserved_position_guard$
DECLARE
  v_rejected boolean := false;
  v_quantity numeric(30,12);
  v_reserved numeric(30,12);
BEGIN
  BEGIN
    DELETE FROM public.paper_crypto_positions
     WHERE user_id = '33333333-3333-4333-8333-333333333333'
       AND symbol = 'BTCUSDT';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Position DELETE unexpectedly succeeded while LIMIT quantity was reserved';
  END IF;

  SELECT quantity, reserved_quantity INTO v_quantity, v_reserved
    FROM public.paper_crypto_positions
   WHERE user_id = '33333333-3333-4333-8333-333333333333'
     AND symbol = 'BTCUSDT';

  IF v_quantity <> 0.008 OR v_reserved <> 0.003 THEN
    RAISE EXCEPTION 'Rejected position DELETE changed quantity or reservation';
  END IF;

  v_rejected := false;
  BEGIN
    UPDATE public.paper_crypto_positions
       SET quantity = 0.002
     WHERE user_id = '33333333-3333-4333-8333-333333333333'
       AND symbol = 'BTCUSDT';
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Position quantity was reduced below its reserved LIMIT SELL quantity';
  END IF;

  UPDATE public.paper_crypto_positions
     SET reserved_quantity = 0
   WHERE user_id = '33333333-3333-4333-8333-333333333333'
     AND symbol = 'BTCUSDT';

  DELETE FROM public.paper_crypto_positions
   WHERE user_id = '33333333-3333-4333-8333-333333333333'
     AND symbol = 'BTCUSDT';
END
$reserved_position_guard$;

RESET ROLE;
ROLLBACK;
