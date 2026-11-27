-- Disposable PostgreSQL schema contract guard for the unified portfolio receipt reader.
-- Read-only: asserts the inspected source contracts exist; no fixture rows or hosted data writes.
DO $portfolio_receipt_contract$
DECLARE
  item record;
  missing_columns text[];
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('paper_accounts', ARRAY['user_id','starting_cash_paise','cash_paise','reserved_cash_paise','reserved_margin_paise','version']::text[]),
      ('paper_equity_positions', ARRAY['user_id','product','instrument_key','quantity','average_price_paise','cost_basis_paise']::text[]),
      ('paper_equity_fills', ARRAY['fill_id','user_id','order_id','execution_id','instrument_key','side','quantity','execution_price_paise','gross_paise','charges_paise','cash_delta_paise','realized_pnl_paise','filled_at']::text[]),
      ('paper_equity_cash_ledger', ARRAY['ledger_id','user_id','order_id','fill_id','event_key','event_type','cash_delta_paise','reserved_cash_delta_paise','cash_balance_after_paise','reserved_cash_after_paise']::text[]),
      ('paper_futures_positions', ARRAY['user_id','instrument_key','net_quantity','average_price_paise','reserved_margin_paise','realized_pnl_paise']::text[]),
      ('paper_futures_orders', ARRAY['order_id','user_id','side','order_type','status','quantity','execution_price_paise','charges_paise','realized_pnl_paise','simulation_only']::text[]),
      ('paper_futures_fills', ARRAY['fill_id','order_id','user_id','execution_id','fill_sequence','quantity','execution_price_paise','gross_paise','charges_paise','realized_pnl_paise','simulation_only']::text[]),
      ('paper_futures_risk_events', ARRAY['event_id','user_id','event_key','event_type','payload_sha256','instrument_key']::text[]),
      ('paper_derivative_positions', ARRAY['user_id','instrument_key','instrument_type','net_quantity','average_price_paise','cost_basis_paise']::text[]),
      ('paper_derivative_orders', ARRAY['order_id','user_id','instrument_key','side','order_type','status','quantity','execution_price_paise','gross_paise','charges_paise','realized_pnl_paise','simulation_only']::text[]),
      ('paper_option_limit_orders', ARRAY['order_id','user_id','instrument_key','side','quantity','filled_quantity','remaining_quantity','status']::text[]),
      ('paper_option_limit_fills', ARRAY['fill_id','order_id','execution_id','fill_sequence','fill_quantity','execution_price_paise','gross_paise','incremental_charges_paise','realized_pnl_paise','simulation_only']::text[]),
      ('paper_option_expiry_settlements', ARRAY['settlement_id','user_id','instrument_key','settled_quantity','entry_cost_basis_paise','gross_payout_paise','exercise_stt_paise','net_payout_paise','realized_pnl_paise','settlement_source_sha256','simulation_only']::text[])
    ) AS t(table_name, columns_required)
  LOOP
    IF to_regclass('public.' || item.table_name) IS NULL THEN
      RAISE EXCEPTION 'Portfolio receipt source table is missing: %', item.table_name;
    END IF;
    SELECT array_agg(u.column_name ORDER BY u.column_name)
      INTO missing_columns
      FROM unnest(item.columns_required) AS u(column_name)
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema='public'
          AND c.table_name=item.table_name
          AND c.column_name=u.column_name
     );
    IF missing_columns IS NOT NULL THEN
      RAISE EXCEPTION 'Portfolio receipt source %.% missing columns: %',
        item.table_name, 'required contract', array_to_string(missing_columns, ', ');
    END IF;
  END LOOP;

  -- Child execution streams must remain linked to their parent order stream.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.paper_equity_fills'::regclass
       AND confrelid='public.paper_orders'::regclass AND contype='f'
  ) THEN
    RAISE EXCEPTION 'Equity fills must reference their canonical paper order';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.paper_equity_cash_ledger'::regclass
       AND confrelid='public.paper_equity_fills'::regclass AND contype='f'
  ) THEN
    RAISE EXCEPTION 'Equity cash-ledger fill references are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.paper_futures_fills'::regclass
       AND confrelid='public.paper_futures_orders'::regclass AND contype='f'
  ) THEN
    RAISE EXCEPTION 'Futures LIMIT fills must reference their parent order';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.paper_option_limit_fills'::regclass
       AND confrelid='public.paper_option_limit_orders'::regclass AND contype='f'
  ) THEN
    RAISE EXCEPTION 'Options LIMIT fills must reference their parent order';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid='public.paper_futures_orders'::regclass
       AND tgname='paper_futures_market_receipt_immutable'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Completed Futures MARKET receipt immutability trigger is missing';
  END IF;

  -- Options expiry settlement is a separate accounting stream with conservation guards.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.paper_option_expiry_settlements'::regclass
       AND conname='paper_option_expiry_payout_conservation'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.paper_option_expiry_settlements'::regclass
       AND conname='paper_option_expiry_realized_conservation'
  ) THEN
    RAISE EXCEPTION 'Options expiry payout/P&L conservation constraints are missing';
  END IF;

  -- MARKET Options are one FILLED order receipt; LIMIT Options have child fill receipts.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.paper_derivative_orders'::regclass
       AND contype='c'
       AND pg_get_constraintdef(oid) ILIKE '%order_type = ''MARKET''%'
  ) THEN
    RAISE EXCEPTION 'Options MARKET-only order contract is missing; receipt mapping needs review';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.paper_option_limit_fills'::regclass
       AND contype='c'
       AND pg_get_constraintdef(oid) ILIKE '%simulation_only%'
  ) THEN
    RAISE EXCEPTION 'Options LIMIT fill simulation-only guard is missing';
  END IF;
END
$portfolio_receipt_contract$;
