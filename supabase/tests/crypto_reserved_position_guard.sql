-- Regression: deleting a crypto position must not orphan pending LIMIT SELL reservations.
-- Run after the S-TRADE Crypto LIMIT lifecycle fixture has created BTCUSDT for user 333...
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
