-- Assert the real pre-migration protective-order fixture was backfilled exactly once.
-- Runs only in the disposable PostgreSQL migration CI database.
DO $reservation_backfill_assertions$
DECLARE
  v_quantity integer;
  v_reserved integer;
BEGIN
  SELECT quantity,reserved_quantity INTO v_quantity,v_reserved
    FROM public.paper_equity_positions
   WHERE user_id='f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0'
     AND product='DELIVERY'
     AND instrument_key='NSE_EQ|RESERVATION_BACKFILL_VALID';

  IF NOT FOUND OR v_quantity<>10 OR v_reserved<>3 THEN
    RAISE EXCEPTION 'Protective reservation backfill mismatch: expected quantity=10 reserved_quantity=3, got quantity=% reserved_quantity=%',
      v_quantity,v_reserved;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.paper_protective_orders
     WHERE user_id='f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0'
       AND status='ACTIVE' AND instrument_key='NSE_EQ|RESERVATION_BACKFILL_VALID'
       AND quantity<>2
  ) THEN
    RAISE EXCEPTION 'Valid protective fixture changed unexpectedly during backfill';
  END IF;
END
$reservation_backfill_assertions$;

DELETE FROM public.paper_protective_orders
 WHERE user_id='f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0';
DELETE FROM public.paper_equity_positions
 WHERE user_id='f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0'
   AND instrument_key='NSE_EQ|RESERVATION_BACKFILL_VALID';
DELETE FROM auth.users
 WHERE id='f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0';
