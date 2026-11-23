-- Futures LIMIT ledger foundation checks. Disposable PostgreSQL CI only.
BEGIN;
DO $ledger_schema$
DECLARE
  v_status_check text;
  v_fill_check text;
  v_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='paper_futures_orders'
       AND column_name='reserved_open_margin_paise'
  ) THEN RAISE EXCEPTION 'Missing pending opening-margin reservation column'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='paper_futures_orders'
       AND column_name='reserved_close_quantity'
  ) THEN RAISE EXCEPTION 'Missing pending close-quantity reservation column'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='paper_futures_positions'
       AND column_name='reserved_close_quantity'
  ) THEN RAISE EXCEPTION 'Missing position close-quantity reservation column'; END IF;
  IF to_regclass('public.paper_futures_fills') IS NULL THEN
    RAISE EXCEPTION 'Missing immutable fill ledger table';
  END IF;
  SELECT count(*) INTO v_count
    FROM pg_indexes
   WHERE schemaname='public' AND tablename='paper_futures_fills'
     AND indexdef LIKE '%(order_id, execution_id)%';
  IF v_count=0 THEN RAISE EXCEPTION 'Missing per-order execution idempotency index'; END IF;
  SELECT pg_get_constraintdef(oid) INTO v_status_check
    FROM pg_constraint
   WHERE conrelid='public.paper_futures_orders'::regclass
     AND conname='paper_futures_orders_status_check';
  IF v_status_check IS NULL OR position('PARTIALLY_FILLED' in v_status_check)=0
     OR position('EXPIRED' in v_status_check)=0 THEN
    RAISE EXCEPTION 'Futures order lifecycle states are incomplete: %',v_status_check;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_fill_check
    FROM pg_constraint
   WHERE conrelid='public.paper_futures_orders'::regclass
     AND conname='paper_futures_order_fill_quantities_check';
  IF v_fill_check IS NULL OR position('order_type = ''MARKET''' in v_fill_check)=0
     OR position('filled_quantity + remaining_quantity = quantity' in v_fill_check)=0 THEN
    RAISE EXCEPTION 'LIMIT quantity conservation must be enforced without breaking legacy MARKET inserts: %',v_fill_check;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name='paper_futures_fills'
       AND grantee IN ('anon','authenticated')
  ) THEN RAISE EXCEPTION 'Client role has direct fill ledger privileges'; END IF;
END
$ledger_schema$;
ROLLBACK;
