-- Disposable PostgreSQL tests for atomic Futures LIMIT partial/full fills.
BEGIN;
INSERT INTO auth.users(id) VALUES ('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd')
ON CONFLICT (id) DO NOTHING;
SELECT public.initialize_paper_trading_account('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd');

INSERT INTO public.paper_exchange_sessions(
  exchange,session_date,is_trading_day,open_minute,close_minute,
  session_kind,source_reference,verified_at,source_sha256
) VALUES (
  'NSE',(clock_timestamp() at time zone 'Asia/Kolkata')::date,
  true,0,1440,'SPECIAL','https://www.nseindia.com/market-data/holidays',clock_timestamp(),repeat('e',64)
)
ON CONFLICT(exchange,session_date) DO UPDATE SET
  is_trading_day=true,open_minute=0,close_minute=1440,
  session_kind='SPECIAL',source_reference='https://www.nseindia.com/market-data/holidays',
  verified_at=clock_timestamp(),source_sha256=repeat('e',64);

DO $futures_limit_fill$
DECLARE
  v_now bigint;
  v_first_quote bigint;
  v_result jsonb;
  v_rejected boolean;
  v_order_status text;
  v_filled integer;
  v_remaining integer;
  v_order_margin bigint;
  v_position_qty integer;
  v_position_avg bigint;
  v_position_margin bigint;
  v_position_close_reserved integer;
  v_account_cash bigint;
  v_account_margin bigint;
  v_account_realized bigint;
  v_fill_count integer;
BEGIN
  -- Submit a BUY LIMIT for 25 units with a trusted 200000-paise reservation.
  PERFORM public.submit_paper_futures_limit_order(
    'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',repeat('a',64),
    'cdcdcdcd-0000-4000-8000-000000000001',repeat('a',64),
    'NSE_FO|FUT_LIMIT_FILL','FUT_LIMIT_FILL','NSE','NSE_FO',current_date+5,
    25,5,'BUY','DELIVERY',25,10000,200000,floor(extract(epoch from clock_timestamp())*1000)::bigint,floor(extract(epoch from clock_timestamp())*1000)::bigint,clock_timestamp()+interval '10 minutes'
  );

  -- First partial fill transfers 80000 paise to the position; account margin
  -- remains unchanged because this is an order-to-position reservation transfer.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_first_quote:=v_now;
  v_result:=public.execute_paper_futures_limit_fill(
    repeat('a',64),'UPSTOX-EXEC-001',1,10,9900,9895,9900,100,10,100,v_first_quote,v_now
  );
  IF v_result->>'status'<>'PARTIALLY_FILLED'
     OR (v_result->>'filled_quantity')::integer<>10
     OR (v_result->>'remaining_quantity')::integer<>15
     OR (v_result->>'allocated_margin_paise')::bigint<>80000 THEN
    RAISE EXCEPTION 'First Futures LIMIT partial fill failed: %',v_result;
  END IF;

  SELECT status,filled_quantity,remaining_quantity,reserved_open_margin_paise
    INTO v_order_status,v_filled,v_remaining,v_order_margin
    FROM public.paper_futures_orders WHERE order_id=repeat('a',64);
  SELECT net_quantity,average_price_paise,reserved_margin_paise
    INTO v_position_qty,v_position_avg,v_position_margin
    FROM public.paper_futures_positions
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
     AND instrument_key='NSE_FO|FUT_LIMIT_FILL';
  SELECT cash_paise,reserved_margin_paise,realized_pnl_paise
    INTO v_account_cash,v_account_margin,v_account_realized
    FROM public.paper_accounts
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  IF v_order_status<>'PARTIALLY_FILLED' OR v_filled<>10 OR v_remaining<>15
     OR v_order_margin<>120000 OR v_position_qty<>10 OR v_position_avg<>9900
     OR v_position_margin<>80000 OR v_account_margin<>200000
     OR v_account_cash<>99999900 OR v_account_realized<>0 THEN
    RAISE EXCEPTION 'First Futures LIMIT partial-fill ledger mismatch';
  END IF;

  -- Exact execution replay is a no-op; altered payload under the same execution
  -- ID is rejected and cannot debit charges or create another fill.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_futures_limit_fill(
    repeat('a',64),'UPSTOX-EXEC-001',1,10,9900,9895,9900,100,10,100,v_first_quote,v_now
  );
  IF (v_result->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Exact Futures LIMIT fill replay was not idempotent';
  END IF;
  v_rejected:=false;
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  BEGIN
    PERFORM public.execute_paper_futures_limit_fill(
      repeat('a',64),'UPSTOX-EXEC-001',1,9,9900,9895,9900,100,10,100,v_first_quote,v_now
    );
  EXCEPTION WHEN SQLSTATE '23505' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Changed Futures execution replay was accepted'; END IF;

  -- Final opening fill receives the exact 120000-paise reservation remainder.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_futures_limit_fill(
    repeat('a',64),'UPSTOX-EXEC-002',2,15,9800,9795,9800,100,15,200,v_now,v_now
  );
  SELECT status,filled_quantity,remaining_quantity,reserved_open_margin_paise,
         average_fill_price_paise
    INTO v_order_status,v_filled,v_remaining,v_order_margin,v_position_avg
    FROM public.paper_futures_orders WHERE order_id=repeat('a',64);
  SELECT net_quantity,average_price_paise,reserved_margin_paise
    INTO v_position_qty,v_position_avg,v_position_margin
    FROM public.paper_futures_positions
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
     AND instrument_key='NSE_FO|FUT_LIMIT_FILL';
  SELECT cash_paise,reserved_margin_paise
    INTO v_account_cash,v_account_margin
    FROM public.paper_accounts
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  IF v_order_status<>'FILLED' OR v_filled<>25 OR v_remaining<>0
     OR v_order_margin<>0 OR v_position_qty<>25 OR v_position_avg<>9840
     OR v_position_margin<>200000 OR v_account_margin<>200000
     OR v_account_cash<>99999700 THEN
    RAISE EXCEPTION 'Final Futures LIMIT fill did not conserve margin/cash or average price';
  END IF;

  -- Close-only SELL LIMIT reserves the long position. A worse-than-limit fill
  -- must fail without changing the reservation or position.
  PERFORM public.submit_paper_futures_limit_order(
    'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',repeat('b',64),
    'cdcdcdcd-0000-4000-8000-000000000002',repeat('b',64),
    'NSE_FO|FUT_LIMIT_FILL','FUT_LIMIT_FILL','NSE','NSE_FO',current_date+5,
    25,5,'SELL','DELIVERY',25,9900,0,null,floor(extract(epoch from clock_timestamp())*1000)::bigint,clock_timestamp()+interval '10 minutes'
  );
  v_rejected:=false;
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  BEGIN
    PERFORM public.execute_paper_futures_limit_fill(
      repeat('b',64),'UPSTOX-EXEC-BAD',1,10,9800,9800,9805,10,100,100,v_now,v_now
    );
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Worse-than-limit Futures SELL fill was accepted'; END IF;

  -- Partial close releases proportional position margin and realizes P&L.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_futures_limit_fill(
    repeat('b',64),'UPSTOX-EXEC-003',1,10,10000,10000,10005,10,100,100,v_now,v_now
  );
  SELECT net_quantity,reserved_margin_paise,reserved_close_quantity
    INTO v_position_qty,v_position_margin,v_position_close_reserved
    FROM public.paper_futures_positions
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
     AND instrument_key='NSE_FO|FUT_LIMIT_FILL';
  SELECT cash_paise,reserved_margin_paise,realized_pnl_paise
    INTO v_account_cash,v_account_margin,v_account_realized
    FROM public.paper_accounts
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  IF v_position_qty<>15 OR v_position_margin<>120000
     OR v_position_close_reserved<>15 OR v_account_margin<>120000
     OR v_account_realized<>1600 OR v_account_cash<>100001200
     OR (v_result->>'allocated_margin_paise')::bigint<>80000 THEN
    RAISE EXCEPTION 'Partial Futures LIMIT close did not reconcile margin/P&L/cash';
  END IF;

  -- Final close consumes the exact residual margin, releases all close quantity,
  -- and safely deletes the now-flat position.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_futures_limit_fill(
    repeat('b',64),'UPSTOX-EXEC-004',2,15,10000,10000,10005,15,100,100,v_now,v_now
  );
  SELECT status,filled_quantity,remaining_quantity
    INTO v_order_status,v_filled,v_remaining
    FROM public.paper_futures_orders WHERE order_id=repeat('b',64);
  SELECT cash_paise,reserved_margin_paise,realized_pnl_paise
    INTO v_account_cash,v_account_margin,v_account_realized
    FROM public.paper_accounts
   WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  SELECT count(*) INTO v_fill_count
    FROM public.paper_futures_fills
   WHERE order_id in (repeat('a',64),repeat('b',64));
  IF v_order_status<>'FILLED' OR v_filled<>25 OR v_remaining<>0
     OR v_account_margin<>0 OR v_account_realized<>4000
     OR v_account_cash<>100003500
     OR EXISTS(SELECT 1 FROM public.paper_futures_positions
        WHERE user_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
          AND instrument_key='NSE_FO|FUT_LIMIT_FILL')
     OR v_fill_count<>4 THEN
    RAISE EXCEPTION 'Final Futures LIMIT close did not reconcile ledger: cash %, margin %, realized %, fills %',
      v_account_cash,v_account_margin,v_account_realized,v_fill_count;
  END IF;

  IF has_function_privilege('anon',
       'public.execute_paper_futures_limit_fill(text,text,integer,integer,bigint,bigint,bigint,integer,integer,bigint,bigint,bigint)',
       'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.execute_paper_futures_limit_fill(text,text,integer,integer,bigint,bigint,bigint,integer,integer,bigint,bigint,bigint)',
       'EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.execute_paper_futures_limit_fill(text,text,integer,integer,bigint,bigint,bigint,integer,integer,bigint,bigint,bigint)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'Futures LIMIT fill RPC execution grants are not least-privilege';
  END IF;
END
$futures_limit_fill$;
ROLLBACK;
