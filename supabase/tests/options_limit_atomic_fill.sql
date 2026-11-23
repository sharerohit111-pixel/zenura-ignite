-- Disposable PostgreSQL accounting regression for atomic NSE Options LIMIT partial/full fills.
BEGIN;
INSERT INTO auth.users(id) VALUES ('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd')
ON CONFLICT (id) DO NOTHING;
SELECT public.initialize_paper_trading_account('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd');

INSERT INTO public.paper_exchange_sessions(
  exchange,session_date,is_trading_day,open_minute,close_minute,
  session_kind,source_reference,verified_at,source_sha256
) VALUES (
  'NSE',(clock_timestamp() at time zone 'Asia/Kolkata')::date,
  true,0,1440,'SPECIAL','https://www.nseindia.com/market-data/holidays',
  clock_timestamp(),repeat('e',64)
)
ON CONFLICT(exchange,session_date) DO UPDATE SET
  is_trading_day=true,open_minute=0,close_minute=1440,session_kind='SPECIAL',
  source_reference='https://www.nseindia.com/market-data/holidays',
  verified_at=clock_timestamp(),source_sha256=repeat('e',64);

DO $options_limit_fill$
DECLARE
  v_now bigint;
  v_first_quote bigint;
  v_result jsonb;
  v_rejected boolean;
  v_status text;
  v_filled integer;
  v_remaining integer;
  v_order_cash bigint;
  v_order_close integer;
  v_order_gross bigint;
  v_order_charges bigint;
  v_position_qty integer;
  v_position_reserved integer;
  v_position_basis bigint;
  v_account_cash bigint;
  v_account_reserved bigint;
  v_account_realized bigint;
  v_fill_count integer;
  v_fill_charges bigint;
BEGIN
  -- Submit one-lot BUY LIMIT: reserve 83,646 paise at the 1,250-paise limit.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.submit_paper_option_limit_order(
    'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',repeat('a',64),
    'cdcdcdcd-0000-4000-8000-000000000001',repeat('a',64),
    'NSE_FO|OPTION_LIMIT_FILL','OPTION_LIMIT_FILL','NSE','NSE_FO','CE',
    current_date+5,25000,65,5,'BUY',65,1250,v_now,clock_timestamp()+interval '10 minutes'
  );

  -- First partial fill: 20 units at the executable ask. Brokerage is charged
  -- once for the order; the remaining reservation must still cover the tail.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_first_quote:=v_now;
  v_result:=public.execute_paper_option_limit_fill(
    repeat('a',64),'UPSTOX-OPTION-EXEC-001',1,20,1240,1235,1240,100,20,v_first_quote,v_now
  );
  IF v_result->>'status'<>'PARTIALLY_FILLED'
     OR (v_result->>'filled_quantity')::integer<>20
     OR (v_result->>'remaining_quantity')::integer<>45
     OR (v_result->>'incremental_charges_paise')::bigint<>2372 THEN
    RAISE EXCEPTION 'First Options BUY partial fill failed: %',v_result;
  END IF;

  SELECT status,filled_quantity,remaining_quantity,reserved_cash_paise,
         cumulative_gross_paise,cumulative_charges_paise
    INTO v_status,v_filled,v_remaining,v_order_cash,v_order_gross,v_order_charges
    FROM public.paper_option_limit_orders WHERE order_id=repeat('a',64);
  SELECT net_quantity,cost_basis_paise,reserved_quantity
    INTO v_position_qty,v_position_basis,v_position_reserved
    FROM public.paper_derivative_positions
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
     AND instrument_key='NSE_FO|OPTION_LIMIT_FILL';
  SELECT cash_paise,reserved_cash_paise
    INTO v_account_cash,v_account_reserved
    FROM public.paper_accounts
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  IF v_status<>'PARTIALLY_FILLED' OR v_filled<>20 OR v_remaining<>45
     OR v_order_cash<>56474 OR v_order_gross<>24800 OR v_order_charges<>2372
     OR v_position_qty<>20 OR v_position_basis<>27172 OR v_position_reserved<>0
     OR v_account_cash<>99972828 OR v_account_reserved<>56474 THEN
    RAISE EXCEPTION 'First Options BUY fill did not conserve order/account/position ledger';
  END IF;

  -- Exact execution replay is a no-op and does not debit the account twice.
  PERFORM pg_sleep(0.02);
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_option_limit_fill(
    repeat('a',64),'UPSTOX-OPTION-EXEC-001',1,20,1240,1235,1240,100,20,v_first_quote,v_now
  );
  IF (v_result->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Exact Options LIMIT fill replay was not idempotent';
  END IF;

  v_rejected:=false;
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  BEGIN
    PERFORM public.execute_paper_option_limit_fill(
      repeat('a',64),'UPSTOX-OPTION-EXEC-001',1,19,1240,1235,1240,100,20,v_first_quote,v_now
    );
  EXCEPTION WHEN SQLSTATE '23505' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Changed Options execution replay was accepted'; END IF;

  -- The final BUY fill consumes the exact remaining reservation and releases
  -- unused limit-price headroom. Cumulative charges remain a single-order fee.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_option_limit_fill(
    repeat('a',64),'UPSTOX-OPTION-EXEC-002',2,45,1235,1230,1235,100,45,v_now,v_now
  );
  SELECT status,filled_quantity,remaining_quantity,reserved_cash_paise,
         cumulative_gross_paise,cumulative_charges_paise
    INTO v_status,v_filled,v_remaining,v_order_cash,v_order_gross,v_order_charges
    FROM public.paper_option_limit_orders WHERE order_id=repeat('a',64);
  SELECT net_quantity,cost_basis_paise,reserved_quantity
    INTO v_position_qty,v_position_basis,v_position_reserved
    FROM public.paper_derivative_positions
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
     AND instrument_key='NSE_FO|OPTION_LIMIT_FILL';
  SELECT cash_paise,reserved_cash_paise
    INTO v_account_cash,v_account_reserved
    FROM public.paper_accounts
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  IF v_status<>'FILLED' OR v_filled<>65 OR v_remaining<>0 OR v_order_cash<>0
     OR v_order_gross<>80375 OR v_order_charges<>2396
     OR v_position_qty<>65 OR v_position_basis<>82771 OR v_position_reserved<>0
     OR v_account_cash<>99917229 OR v_account_reserved<>0 THEN
    RAISE EXCEPTION 'Final Options BUY fill failed reservation/account/cost-basis conservation';
  END IF;

  -- Submit a SELL-to-close LIMIT for the full long position.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.submit_paper_option_limit_order(
    'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',repeat('b',64),
    'cdcdcdcd-0000-4000-8000-000000000002',repeat('b',64),
    'NSE_FO|OPTION_LIMIT_FILL','OPTION_LIMIT_FILL','NSE','NSE_FO','CE',
    current_date+5,25000,65,5,'SELL',65,1300,v_now,clock_timestamp()+interval '10 minutes'
  );

  -- Partial SELL releases 20 close units and realizes fee-inclusive P&L.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_option_limit_fill(
    repeat('b',64),'UPSTOX-OPTION-EXEC-003',1,20,1300,1300,1305,20,100,v_now,v_now
  );
  SELECT net_quantity,cost_basis_paise,reserved_quantity
    INTO v_position_qty,v_position_basis,v_position_reserved
    FROM public.paper_derivative_positions
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
     AND instrument_key='NSE_FO|OPTION_LIMIT_FILL';
  SELECT status,filled_quantity,remaining_quantity,reserved_close_quantity,
         cumulative_gross_paise,cumulative_charges_paise
    INTO v_status,v_filled,v_remaining,v_order_close,v_order_gross,v_order_charges
    FROM public.paper_option_limit_orders WHERE order_id=repeat('b',64);
  SELECT cash_paise,realized_pnl_paise INTO v_account_cash,v_account_realized
    FROM public.paper_accounts
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  IF v_status<>'PARTIALLY_FILLED' OR v_filled<>20 OR v_remaining<>45
     OR v_order_close<>45 OR v_order_gross<>26000 OR v_order_charges<>2410
     OR v_position_qty<>45 OR v_position_basis<>57303 OR v_position_reserved<>45
     OR v_account_cash<>99940819 OR v_account_realized<>-1878 THEN
    RAISE EXCEPTION 'Partial Options SELL fill failed close-reservation/P&L conservation';
  END IF;

  -- Final SELL fill closes the exact remaining long position and releases the
  -- remaining close reservation. Incremental charges are only the cumulative delta.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_option_limit_fill(
    repeat('b',64),'UPSTOX-OPTION-EXEC-004',2,45,1305,1305,1310,45,100,v_now,v_now
  );
  SELECT status,filled_quantity,remaining_quantity,reserved_close_quantity,
         cumulative_gross_paise,cumulative_charges_paise
    INTO v_status,v_filled,v_remaining,v_order_close,v_order_gross,v_order_charges
    FROM public.paper_option_limit_orders WHERE order_id=repeat('b',64);
  SELECT cash_paise,realized_pnl_paise,reserved_cash_paise
    INTO v_account_cash,v_account_realized,v_account_reserved
    FROM public.paper_accounts
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  SELECT count(*),coalesce(sum(incremental_charges_paise),0)
    INTO v_fill_count,v_fill_charges
    FROM public.paper_option_limit_fills
   WHERE order_id in (repeat('a',64),repeat('b',64));
  IF v_status<>'FILLED' OR v_filled<>65 OR v_remaining<>0 OR v_order_close<>0
     OR v_order_gross<>84725 OR v_order_charges<>2522
     OR v_account_cash<>99999432 OR v_account_realized<>-568
     OR v_account_reserved<>0 OR v_fill_count<>4 OR v_fill_charges<>4918
     OR EXISTS(SELECT 1 FROM public.paper_derivative_positions
       WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
         AND instrument_key='NSE_FO|OPTION_LIMIT_FILL') THEN
    RAISE EXCEPTION 'Final Options SELL fill failed ledger reconciliation';
  END IF;

  -- A worse-than-limit execution must fail without adding a fill.
  PERFORM public.submit_paper_option_limit_order(
    'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',repeat('c',64),
    'cdcdcdcd-0000-4000-8000-000000000003',repeat('c',64),
    'NSE_FO|OPTION_LIMIT_BAD_FILL','OPTION_LIMIT_BAD_FILL','NSE','NSE_FO','PE',
    current_date+5,25000,65,5,'BUY',65,1250,
    floor(extract(epoch from clock_timestamp())*1000)::bigint,
    clock_timestamp()+interval '10 minutes'
  );
  v_rejected:=false;
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  BEGIN
    PERFORM public.execute_paper_option_limit_fill(
      repeat('c',64),'UPSTOX-OPTION-EXEC-BAD',1,10,1255,1250,1255,100,10,v_now,v_now
    );
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Worse-than-limit Options BUY fill was accepted'; END IF;

  IF has_function_privilege('anon',
       'public.execute_paper_option_limit_fill(text,text,integer,integer,bigint,bigint,bigint,integer,integer,bigint,bigint)',
       'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.execute_paper_option_limit_fill(text,text,integer,integer,bigint,bigint,bigint,integer,integer,bigint,bigint)',
       'EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.execute_paper_option_limit_fill(text,text,integer,integer,bigint,bigint,bigint,integer,integer,bigint,bigint)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'Options LIMIT fill RPC execution grants are not least-privilege';
  END IF;
END
$options_limit_fill$;
ROLLBACK;
