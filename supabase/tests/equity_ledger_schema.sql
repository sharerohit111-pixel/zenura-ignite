-- Schema and immutability checks for the equity audit-ledger foundation.
-- Executed by the disposable PostgreSQL migration test workflow.
DO $equity_ledger_schema_checks$
DECLARE
  v_fill_trigger boolean;
  v_cash_trigger boolean;
BEGIN
  IF to_regclass('public.paper_equity_fills') IS NULL
     OR to_regclass('public.paper_equity_cash_ledger') IS NULL THEN
    RAISE EXCEPTION 'Equity fill and cash ledger tables must exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.paper_equity_fills'::regclass
       AND conname='paper_equity_fills_order_execution_unique'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.paper_equity_cash_ledger'::regclass
       AND conname='paper_equity_cash_ledger_user_event_unique'
  ) THEN
    RAISE EXCEPTION 'Equity fill/ledger idempotency constraints are missing';
  END IF;

  IF NOT has_table_privilege('service_role','public.paper_equity_fills','INSERT')
     OR NOT has_table_privilege('service_role','public.paper_equity_cash_ledger','INSERT')
     OR has_table_privilege('authenticated','public.paper_equity_fills','SELECT')
     OR has_table_privilege('authenticated','public.paper_equity_cash_ledger','SELECT')
     OR has_table_privilege('anon','public.paper_equity_fills','INSERT')
     OR has_table_privilege('anon','public.paper_equity_cash_ledger','INSERT') THEN
    RAISE EXCEPTION 'Equity ledger table grants are not service-role-only';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid='public.paper_equity_fills'::regclass
       AND tgname='paper_equity_fills_append_only' AND NOT tgisinternal
  ) INTO v_fill_trigger;
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid='public.paper_equity_cash_ledger'::regclass
       AND tgname='paper_equity_cash_ledger_append_only' AND NOT tgisinternal
  ) INTO v_cash_trigger;
  IF NOT v_fill_trigger OR NOT v_cash_trigger THEN
    RAISE EXCEPTION 'Append-only mutation guards are missing';
  END IF;
END
$equity_ledger_schema_checks$;

-- Trigger behavior is exercised with disposable fixture rows, then rolled back.
BEGIN;
INSERT INTO auth.users(id) VALUES ('77777777-7777-4777-8777-777777777777')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.paper_orders(
  order_id,user_id,request_fingerprint,instrument_key,side,product,
  order_type,status,quantity,simulation_only
) VALUES (
  repeat('7',64),'77777777-7777-4777-8777-777777777777',repeat('8',64),
  'NSE_EQ|LEDGER_CI','BUY','DELIVERY','MARKET','FILLED',1,true
);
INSERT INTO public.paper_equity_fills(
  user_id,order_id,execution_id,instrument_key,exchange,product,side,
  quantity,execution_price_paise,gross_paise,charges_paise,
  charges_breakdown,cash_delta_paise,quote_timestamp_ms
) VALUES (
  '77777777-7777-4777-8777-777777777777',repeat('7',64),'fill-1',
  'NSE_EQ|LEDGER_CI','NSE','DELIVERY','BUY',1,10000,10000,10,
  '{"indicative":true}'::jsonb,-10010,1
);
DO $equity_ledger_immutable_checks$
BEGIN
  BEGIN
    UPDATE public.paper_equity_fills SET quantity=2
     WHERE order_id=repeat('7',64);
    RAISE EXCEPTION 'Equity fill UPDATE unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM public.paper_equity_fills WHERE order_id=repeat('7',64);
    RAISE EXCEPTION 'Equity fill DELETE unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
END
$equity_ledger_immutable_checks$;
ROLLBACK;
