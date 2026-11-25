-- Disposable CI regression for fee-inclusive long-option buy/close ledger accounting.
-- Verifies account cash and realized P&L reconcile to immutable filled-order history.
BEGIN;

INSERT INTO auth.users(id)
VALUES ('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd')
ON CONFLICT (id) DO NOTHING;
SELECT public.initialize_paper_trading_account('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd');

DO $option_ledger$
DECLARE
  v_now bigint;
  v_result jsonb;
  v_cash bigint;
  v_realized bigint;
  v_reserved_margin bigint;
  v_position_qty integer;
  v_position_basis bigint;
  v_buy_gross bigint;
  v_sell_gross bigint;
  v_total_charges bigint;
  v_order_realized bigint;
  v_expected_cash bigint;
  v_buy_basis bigint;
  v_closed_basis bigint;
BEGIN
  -- Buy one long CE lot; premium and buy-side charges enter fee-inclusive cost basis.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_long_option_order(
    'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
    repeat('a',64),'cdcdcdcd-0000-4000-8000-000000000001',repeat('b',64),
    'NSE_FO|OPTION_LEDGER_CE','OPTION_LEDGER_CE',
    'NSE','NSE_FO','CE',current_date+5,25000,65,5,1,'BUY',1250,v_now,v_now
  );
  IF v_result->>'idempotent_replay' IS DISTINCT FROM 'false'
     OR v_result->>'simulation_only' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Long-option BUY did not return a new simulation-only fill: %',v_result;
  END IF;

  -- Exact replay must not debit the account or increase the fee-inclusive basis again.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_long_option_order(
    'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
    repeat('a',64),'cdcdcdcd-0000-4000-8000-000000000001',repeat('b',64),
    'NSE_FO|OPTION_LEDGER_CE','OPTION_LEDGER_CE',
    'NSE','NSE_FO','CE',current_date+5,25000,65,5,1,'BUY',1250,v_now,v_now
  );
  IF v_result->>'idempotent_replay' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Long-option BUY retry was not idempotent: %',v_result;
  END IF;

  -- Close the entire long lot at a higher premium.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_long_option_order(
    'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
    repeat('c',64),'cdcdcdcd-0000-4000-8000-000000000002',repeat('d',64),
    'NSE_FO|OPTION_LEDGER_CE','OPTION_LEDGER_CE',
    'NSE','NSE_FO','CE',current_date+5,25000,65,5,1,'SELL',1500,v_now,v_now
  );
  IF v_result->>'simulation_only' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Long-option SELL did not remain simulation-only: %',v_result;
  END IF;

  SELECT coalesce(sum(gross_paise) FILTER (WHERE side='BUY'),0),
         coalesce(sum(gross_paise) FILTER (WHERE side='SELL'),0),
         coalesce(sum(charges_paise),0),
         coalesce(sum(realized_pnl_paise),0)
    INTO v_buy_gross,v_sell_gross,v_total_charges,v_order_realized
    FROM public.paper_derivative_orders
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
     AND instrument_key='NSE_FO|OPTION_LEDGER_CE'
     AND status='FILLED' AND simulation_only IS TRUE;

  SELECT cash_paise,realized_pnl_paise,reserved_margin_paise
    INTO v_cash,v_realized,v_reserved_margin
    FROM public.paper_accounts
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';

  SELECT starting_cash_paise-v_buy_gross+v_sell_gross-v_total_charges
    INTO v_expected_cash
    FROM public.paper_accounts
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';

  IF EXISTS (
    SELECT 1 FROM public.paper_derivative_positions
     WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
       AND instrument_key='NSE_FO|OPTION_LEDGER_CE'
  ) THEN
    RAISE EXCEPTION 'Fully closed long-option position remains in the derivative ledger';
  END IF;

  IF v_cash<>v_expected_cash
     OR v_realized<>v_order_realized
     OR v_reserved_margin<>0
     OR v_buy_gross<>81250
     OR v_sell_gross<>97500
     OR v_order_realized<=0
     OR v_expected_cash<=0 THEN
    RAISE EXCEPTION 'Option ledger reconciliation failed: cash %, expected cash %, account realized %, order realized %, margin %, buy gross %, sell gross %, charges %',
      v_cash,v_expected_cash,v_realized,v_order_realized,v_reserved_margin,
      v_buy_gross,v_sell_gross,v_total_charges;
  END IF;

  -- Repeated lot-by-lot partial closes must conserve the exact fee-inclusive
  -- entry basis: the sum of all released basis must equal the original BUY basis.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.execute_paper_long_option_order(
    'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
    repeat('e',32)||repeat('1',32),'cdcdcdcd-0000-4000-8000-000000000010',repeat('a',64),
    'NSE_FO|OPTION_PARTIAL_CLOSE','OPTION_PARTIAL_CLOSE',
    'NSE','NSE_FO','CE',current_date+5,25000,25,5,3,'BUY',1250,v_now,v_now
  );

  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.execute_paper_long_option_order(
    'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
    repeat('e',32)||repeat('2',32),'cdcdcdcd-0000-4000-8000-000000000011',repeat('b',64),
    'NSE_FO|OPTION_PARTIAL_CLOSE','OPTION_PARTIAL_CLOSE',
    'NSE','NSE_FO','CE',current_date+5,25000,25,5,1,'SELL',1500,v_now,v_now
  );
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.execute_paper_long_option_order(
    'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
    repeat('e',32)||repeat('3',32),'cdcdcdcd-0000-4000-8000-000000000012',repeat('c',64),
    'NSE_FO|OPTION_PARTIAL_CLOSE','OPTION_PARTIAL_CLOSE',
    'NSE','NSE_FO','CE',current_date+5,25000,25,5,1,'SELL',1400,v_now,v_now
  );
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.execute_paper_long_option_order(
    'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
    repeat('e',32)||repeat('4',32),'cdcdcdcd-0000-4000-8000-000000000013',repeat('d',64),
    'NSE_FO|OPTION_PARTIAL_CLOSE','OPTION_PARTIAL_CLOSE',
    'NSE','NSE_FO','CE',current_date+5,25000,25,5,1,'SELL',1300,v_now,v_now
  );

  SELECT coalesce(sum(gross_paise+charges_paise) FILTER (WHERE side='BUY'),0),
         coalesce(sum(gross_paise-charges_paise-realized_pnl_paise) FILTER (WHERE side='SELL'),0)
    INTO v_buy_basis,v_closed_basis
    FROM public.paper_derivative_orders
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
     AND instrument_key='NSE_FO|OPTION_PARTIAL_CLOSE'
     AND status='FILLED' AND simulation_only IS TRUE;
  IF v_buy_basis<=0 OR v_closed_basis<>v_buy_basis
     OR EXISTS(SELECT 1 FROM public.paper_derivative_positions
       WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
         AND instrument_key='NSE_FO|OPTION_PARTIAL_CLOSE') THEN
    RAISE EXCEPTION 'Repeated partial option closes did not conserve the exact fee-inclusive entry basis: bought %, released %',
      v_buy_basis,v_closed_basis;
  END IF;

END
$option_ledger$;

ROLLBACK;
