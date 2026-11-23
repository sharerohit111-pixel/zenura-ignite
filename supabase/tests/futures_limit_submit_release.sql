-- Disposable PostgreSQL tests for Futures LIMIT submit/cancel/expiry RPCs.
BEGIN;
INSERT INTO auth.users(id) VALUES ('abababab-abab-4bab-8bab-abababababab')
ON CONFLICT (id) DO NOTHING;
SELECT public.initialize_paper_trading_account('abababab-abab-4bab-8bab-abababababab');

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

DO $futures_limit_submit_release$
DECLARE
  v_now bigint;
  v_result jsonb;
  v_rejected boolean;
  v_reserved bigint;
  v_qty integer;
  v_close_reserved integer;
  v_status text;
BEGIN
  -- Seed a two-lot long Futures position using the unchanged MARKET RPC.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.execute_paper_futures_market_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('1',64),
    'abababab-0000-4000-8000-000000000001',repeat('a',64),
    'NSE_FO|FUT_LIMIT_CLOSE','FUT_LIMIT_CLOSE','NSE','NSE_FO',current_date+5,
    25,5,'BUY','DELIVERY',50,10000,200000,1000,v_now,v_now
  );

  -- Reserve one lot for a close-only SELL LIMIT. No opening margin is charged.
  v_result:=public.submit_paper_futures_limit_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('c',64),
    'abababab-0000-4000-8000-000000000002',repeat('b',64),
    'NSE_FO|FUT_LIMIT_CLOSE','FUT_LIMIT_CLOSE','NSE','NSE_FO',current_date+5,
    25,5,'SELL','DELIVERY',25,12000,0,null,floor(extract(epoch from clock_timestamp())*1000)::bigint,clock_timestamp()+interval '10 minutes'
  );
  IF v_result->>'status'<>'PENDING'
     OR (v_result->>'reserved_close_quantity')::integer<>25
     OR (v_result->>'reserved_open_margin_paise')::bigint<>0 THEN
    RAISE EXCEPTION 'Close-only Futures LIMIT reservation failed: %',v_result;
  END IF;

  SELECT net_quantity,reserved_close_quantity
    INTO v_qty,v_close_reserved
    FROM public.paper_futures_positions
   WHERE user_id='abababab-abab-4bab-8bab-abababababab'
     AND instrument_key='NSE_FO|FUT_LIMIT_CLOSE';
  IF v_qty<>50 OR v_close_reserved<>25 THEN
    RAISE EXCEPTION 'Close-only reservation did not update the position atomically';
  END IF;

  -- A second close-only order cannot reserve the same contracts twice.
  v_rejected:=false;
  BEGIN
    PERFORM public.submit_paper_futures_limit_order(
      'abababab-abab-4bab-8bab-abababababab',repeat('d',64),
      'abababab-0000-4000-8000-000000000003',repeat('c',64),
      'NSE_FO|FUT_LIMIT_CLOSE','FUT_LIMIT_CLOSE','NSE','NSE_FO',current_date+5,
      25,5,'SELL','DELIVERY',50,12000,0,null,floor(extract(epoch from clock_timestamp())*1000)::bigint,clock_timestamp()+interval '10 minutes'
    );
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Overlapping Futures close reservation was accepted';
  END IF;

  -- Existing MARKET RPC must not consume quantity held by a pending LIMIT close.
  v_rejected:=false;
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  BEGIN
    PERFORM public.execute_paper_futures_market_order(
      'abababab-abab-4bab-8bab-abababababab',repeat('e',64),
      'abababab-0000-4000-8000-000000000004',repeat('d',64),
      'NSE_FO|FUT_LIMIT_CLOSE','FUT_LIMIT_CLOSE','NSE','NSE_FO',current_date+5,
      25,5,'SELL','DELIVERY',50,11000,0,1000,v_now,v_now
    );
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Futures MARKET close consumed LIMIT-reserved quantity';
  END IF;

  -- An unreserved one-lot MARKET close remains compatible and leaves the
  -- reserved one-lot close quantity available to its owning LIMIT order.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.execute_paper_futures_market_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('f',64),
    'abababab-0000-4000-8000-000000000005',repeat('e',64),
    'NSE_FO|FUT_LIMIT_CLOSE','FUT_LIMIT_CLOSE','NSE','NSE_FO',current_date+5,
    25,5,'SELL','DELIVERY',25,11000,0,1000,v_now,v_now
  );
  SELECT net_quantity,reserved_close_quantity
    INTO v_qty,v_close_reserved
    FROM public.paper_futures_positions
   WHERE user_id='abababab-abab-4bab-8bab-abababababab'
     AND instrument_key='NSE_FO|FUT_LIMIT_CLOSE';
  IF v_qty<>25 OR v_close_reserved<>25 THEN
    RAISE EXCEPTION 'Existing MARKET flow did not preserve pending LIMIT close reservation';
  END IF;

  v_result:=public.cancel_paper_futures_limit_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('c',64)
  );
  IF v_result->>'status'<>'CANCELLED'
     OR (v_result->>'released_close_quantity')::integer<>25 THEN
    RAISE EXCEPTION 'Close-only Futures LIMIT cancellation failed: %',v_result;
  END IF;
  -- Repeated cancellation is idempotent and does not release twice.
  v_result:=public.cancel_paper_futures_limit_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('c',64)
  );
  IF (v_result->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Repeated Futures LIMIT cancellation was not idempotent';
  END IF;

  -- Once the close reservation is released, the remaining MARKET close succeeds.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.execute_paper_futures_market_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('7',64),
    'abababab-0000-4000-8000-000000000006',repeat('f',64),
    'NSE_FO|FUT_LIMIT_CLOSE','FUT_LIMIT_CLOSE','NSE','NSE_FO',current_date+5,
    25,5,'SELL','DELIVERY',25,11000,0,1000,v_now,v_now
  );

  -- Opening BUY LIMIT reserves margin once, and exact idempotent replay is free.
  v_result:=public.submit_paper_futures_limit_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('8',64),
    'abababab-0000-4000-8000-000000000007',repeat('1',64),
    'NSE_FO|FUT_LIMIT_OPEN','FUT_LIMIT_OPEN','NSE','NSE_FO',current_date+5,
    25,5,'BUY','DELIVERY',25,10000,150000,floor(extract(epoch from clock_timestamp())*1000)::bigint,floor(extract(epoch from clock_timestamp())*1000)::bigint,clock_timestamp()+interval '10 minutes'
  );
  SELECT reserved_margin_paise INTO v_reserved
    FROM public.paper_accounts
   WHERE user_id='abababab-abab-4bab-8bab-abababababab';
  IF v_reserved<>150000 THEN
    RAISE EXCEPTION 'Opening Futures LIMIT margin was not reserved exactly once: %',v_reserved;
  END IF;
  v_result:=public.submit_paper_futures_limit_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('8',64),
    'abababab-0000-4000-8000-000000000007',repeat('1',64),
    'NSE_FO|FUT_LIMIT_OPEN','FUT_LIMIT_OPEN','NSE','NSE_FO',current_date+5,
    25,5,'BUY','DELIVERY',25,10000,150000,floor(extract(epoch from clock_timestamp())*1000)::bigint,floor(extract(epoch from clock_timestamp())*1000)::bigint,clock_timestamp()+interval '10 minutes'
  );
  IF (v_result->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Opening Futures LIMIT replay was not idempotent';
  END IF;
  SELECT reserved_margin_paise INTO v_reserved
    FROM public.paper_accounts
   WHERE user_id='abababab-abab-4bab-8bab-abababababab';
  IF v_reserved<>150000 THEN
    RAISE EXCEPTION 'Opening Futures LIMIT replay double-reserved margin';
  END IF;

  v_rejected:=false;
  BEGIN
    PERFORM public.submit_paper_futures_limit_order(
      'abababab-abab-4bab-8bab-abababababab',repeat('8',64),
      'abababab-0000-4000-8000-000000000007',repeat('2',64),
      'NSE_FO|FUT_LIMIT_OPEN','FUT_LIMIT_OPEN','NSE','NSE_FO',current_date+5,
      25,5,'BUY','DELIVERY',25,10000,150000,floor(extract(epoch from clock_timestamp())*1000)::bigint,floor(extract(epoch from clock_timestamp())*1000)::bigint,clock_timestamp()+interval '10 minutes'
    );
  EXCEPTION WHEN SQLSTATE '23505' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Changed Futures LIMIT idempotency fingerprint was accepted';
  END IF;

  v_result:=public.cancel_paper_futures_limit_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('8',64)
  );
  SELECT reserved_margin_paise INTO v_reserved
    FROM public.paper_accounts
   WHERE user_id='abababab-abab-4bab-8bab-abababababab';
  IF v_reserved<>0 OR (v_result->>'released_open_margin_paise')::bigint<>150000 THEN
    RAISE EXCEPTION 'Opening Futures LIMIT cancel leaked reserved margin';
  END IF;

  -- Expiry is only permitted after expires_at and releases its residual margin once.
  PERFORM public.submit_paper_futures_limit_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('9',64),
    'abababab-0000-4000-8000-000000000008',repeat('3',64),
    'NSE_FO|FUT_LIMIT_EXPIRY','FUT_LIMIT_EXPIRY','NSE','NSE_FO',current_date+5,
    25,5,'BUY','DELIVERY',25,10000,125000,floor(extract(epoch from clock_timestamp())*1000)::bigint,floor(extract(epoch from clock_timestamp())*1000)::bigint,clock_timestamp()+interval '1 second'
  );
  PERFORM pg_sleep(1.1);
  v_result:=public.expire_paper_futures_limit_order(repeat('9',64));
  SELECT reserved_margin_paise INTO v_reserved
    FROM public.paper_accounts
   WHERE user_id='abababab-abab-4bab-8bab-abababababab';
  SELECT status INTO v_status
    FROM public.paper_futures_orders WHERE order_id=repeat('9',64);
  IF v_status<>'EXPIRED' OR v_reserved<>0
     OR (v_result->>'released_open_margin_paise')::bigint<>125000 THEN
    RAISE EXCEPTION 'Futures LIMIT expiry did not release margin exactly once';
  END IF;
  v_result:=public.expire_paper_futures_limit_order(repeat('9',64));
  IF (v_result->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Repeated Futures LIMIT expiry was not idempotent';
  END IF;

  -- A replay of an already-expired submit remains idempotent even though the
  -- original expires_at is now in the past.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.submit_paper_futures_limit_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('9',64),
    'abababab-0000-4000-8000-000000000008',repeat('3',64),
    'NSE_FO|FUT_LIMIT_EXPIRY','FUT_LIMIT_EXPIRY','NSE','NSE_FO',current_date+5,
    25,5,'BUY','DELIVERY',25,10000,125000,null,v_now,clock_timestamp()-interval '1 second'
  );
  IF v_result->>'status'<>'EXPIRED'
     OR (v_result->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Expired Futures LIMIT submit replay was not idempotent: %',v_result;
  END IF;

  -- A future-dated DAY order cannot be expired while a verified exchange
  -- session is open; missing verified session data must fail closed by expiring it.
  PERFORM public.submit_paper_futures_limit_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('4',64),
    'abababab-0000-4000-8000-000000000009',repeat('4',64),
    'NSE_FO|FUT_LIMIT_NO_SESSION','FUT_LIMIT_NO_SESSION','NSE','NSE_FO',current_date+5,
    25,5,'BUY','DELIVERY',25,10000,50000,floor(extract(epoch from clock_timestamp())*1000)::bigint,floor(extract(epoch from clock_timestamp())*1000)::bigint,clock_timestamp()+interval '10 minutes'
  );
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
  v_rejected:=false;
  BEGIN
    PERFORM public.expire_paper_futures_limit_order(repeat('4',64));
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Futures LIMIT order expired during a verified open session';
  END IF;
  DELETE FROM public.paper_exchange_sessions
   WHERE exchange='NSE'
     AND session_date=(clock_timestamp() at time zone 'Asia/Kolkata')::date;
  v_result:=public.expire_paper_futures_limit_order(repeat('4',64));
  SELECT reserved_margin_paise INTO v_reserved
    FROM public.paper_accounts
   WHERE user_id='abababab-abab-4bab-8bab-abababababab';
  IF v_result->>'status'<>'EXPIRED' OR v_reserved<>0 THEN
    RAISE EXCEPTION 'Futures LIMIT order was not expired after verified session data disappeared';
  END IF;

  IF has_function_privilege('anon',
       'public.submit_paper_futures_limit_order(uuid,text,uuid,text,text,text,text,text,date,integer,integer,text,text,integer,bigint,bigint,bigint,bigint,timestamp with time zone)',
       'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.cancel_paper_futures_limit_order(uuid,text)','EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.expire_paper_futures_limit_order(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Futures LIMIT RPC execution grants are not least-privilege';
  END IF;
END
$futures_limit_submit_release$;
ROLLBACK;
