-- Disposable PostgreSQL tests for atomic NSE Options LIMIT submit/cancel/expiry.
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

DO $options_limit_submit_release$
DECLARE
  v_now bigint;
  v_result jsonb;
  v_rejected boolean;
  v_reserved_cash bigint;
  v_reserved_close integer;
  v_quantity integer;
  v_status text;
BEGIN
  -- BUY LIMIT reserves premium at the limit price plus the full estimated
  -- one-order fee schedule. For 65 x 1250 paise this is 83,646 paise.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.submit_paper_option_limit_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('a',64),
    'abababab-0000-4000-8000-000000000001',repeat('b',64),
    'NSE_FO|OPTION_LIMIT_BUY','OPTION_LIMIT_BUY','NSE','NSE_FO','CE',
    current_date+5,25000,65,5,'BUY',65,1250,v_now,clock_timestamp()+interval '10 minutes'
  );
  IF v_result->>'status'<>'PENDING'
     OR (v_result->>'reserved_cash_paise')::bigint<>83646
     OR (v_result->>'reserved_close_quantity')::integer<>0 THEN
    RAISE EXCEPTION 'Options BUY LIMIT reservation was not created correctly: %',v_result;
  END IF;
  SELECT reserved_cash_paise INTO v_reserved_cash
    FROM public.paper_accounts
   WHERE user_id='abababab-abab-4bab-8bab-abababababab';
  IF v_reserved_cash<>83646 THEN
    RAISE EXCEPTION 'Account cash reservation does not match the order reservation';
  END IF;

  -- Exact retry is idempotent and must not reserve cash twice.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.submit_paper_option_limit_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('a',64),
    'abababab-0000-4000-8000-000000000001',repeat('b',64),
    'NSE_FO|OPTION_LIMIT_BUY','OPTION_LIMIT_BUY','NSE','NSE_FO','CE',
    current_date+5,25000,65,5,'BUY',65,1250,v_now,clock_timestamp()+interval '10 minutes'
  );
  IF (v_result->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Options BUY LIMIT retry was not idempotent';
  END IF;
  SELECT reserved_cash_paise INTO v_reserved_cash
    FROM public.paper_accounts
   WHERE user_id='abababab-abab-4bab-8bab-abababababab';
  IF v_reserved_cash<>83646 THEN
    RAISE EXCEPTION 'Options BUY LIMIT retry double-reserved cash';
  END IF;

  -- Same idempotency key with a changed fingerprint is a hard conflict.
  v_rejected:=false;
  BEGIN
    PERFORM public.submit_paper_option_limit_order(
      'abababab-abab-4bab-8bab-abababababab',repeat('a',64),
      'abababab-0000-4000-8000-000000000001',repeat('c',64),
      'NSE_FO|OPTION_LIMIT_BUY','OPTION_LIMIT_BUY','NSE','NSE_FO','CE',
      current_date+5,25000,65,5,'BUY',65,1250,v_now,clock_timestamp()+interval '10 minutes'
    );
  EXCEPTION WHEN SQLSTATE '23505' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Changed Options LIMIT idempotency fingerprint was accepted';
  END IF;

  -- Cancel releases only the remaining cash reservation, once.
  v_result:=public.cancel_paper_option_limit_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('a',64)
  );
  IF v_result->>'status'<>'CANCELLED'
     OR (v_result->>'released_cash_paise')::bigint<>83646 THEN
    RAISE EXCEPTION 'Options BUY LIMIT cancel did not release reserved cash: %',v_result;
  END IF;
  v_result:=public.cancel_paper_option_limit_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('a',64)
  );
  IF (v_result->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Repeated Options LIMIT cancel was not idempotent';
  END IF;

  -- Seed a two-lot long CE position through the unchanged MARKET RPC.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.execute_paper_long_option_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('1',64),
    'abababab-0000-4000-8000-000000000002',repeat('1',64),
    'NSE_FO|OPTION_LIMIT_CLOSE','OPTION_LIMIT_CLOSE',
    'NSE','NSE_FO','CE',current_date+5,25000,65,5,2,'BUY',1250,v_now,v_now
  );

  -- Reserve one lot for SELL-to-close. A second overlapping close must fail.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.submit_paper_option_limit_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('2',64),
    'abababab-0000-4000-8000-000000000003',repeat('2',64),
    'NSE_FO|OPTION_LIMIT_CLOSE','OPTION_LIMIT_CLOSE','NSE','NSE_FO','CE',
    current_date+5,25000,65,5,'SELL',65,1500,v_now,clock_timestamp()+interval '10 minutes'
  );
  IF v_result->>'status'<>'PENDING'
     OR (v_result->>'reserved_close_quantity')::integer<>65 THEN
    RAISE EXCEPTION 'Options SELL LIMIT close reservation failed: %',v_result;
  END IF;
  SELECT net_quantity,reserved_quantity INTO v_quantity,v_reserved_close
    FROM public.paper_derivative_positions
   WHERE user_id='abababab-abab-4bab-8bab-abababababab'
     AND instrument_key='NSE_FO|OPTION_LIMIT_CLOSE';
  IF v_quantity<>130 OR v_reserved_close<>65 THEN
    RAISE EXCEPTION 'Options SELL LIMIT did not reserve the close quantity';
  END IF;

  v_rejected:=false;
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  BEGIN
    PERFORM public.submit_paper_option_limit_order(
      'abababab-abab-4bab-8bab-abababababab',repeat('3',64),
      'abababab-0000-4000-8000-000000000004',repeat('3',64),
      'NSE_FO|OPTION_LIMIT_CLOSE','OPTION_LIMIT_CLOSE','NSE','NSE_FO','CE',
      current_date+5,25000,65,5,'SELL',130,1500,v_now,clock_timestamp()+interval '10 minutes'
    );
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Overlapping Options SELL LIMIT close reservation was accepted';
  END IF;

  -- Existing MARKET SELL cannot consume the reserved lot, but may close the
  -- unreserved lot. This proves MARKET compatibility and reservation isolation.
  v_rejected:=false;
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  BEGIN
    PERFORM public.execute_paper_long_option_order(
      'abababab-abab-4bab-8bab-abababababab',repeat('4',64),
      'abababab-0000-4000-8000-000000000005',repeat('4',64),
      'NSE_FO|OPTION_LIMIT_CLOSE','OPTION_LIMIT_CLOSE',
      'NSE','NSE_FO','CE',current_date+5,25000,65,5,2,'SELL',1500,v_now,v_now
    );
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Existing Options MARKET SELL consumed LIMIT-reserved quantity';
  END IF;

  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.execute_paper_long_option_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('5',64),
    'abababab-0000-4000-8000-000000000006',repeat('5',64),
    'NSE_FO|OPTION_LIMIT_CLOSE','OPTION_LIMIT_CLOSE',
    'NSE','NSE_FO','CE',current_date+5,25000,65,5,1,'SELL',1500,v_now,v_now
  );
  SELECT net_quantity,reserved_quantity INTO v_quantity,v_reserved_close
    FROM public.paper_derivative_positions
   WHERE user_id='abababab-abab-4bab-8bab-abababababab'
     AND instrument_key='NSE_FO|OPTION_LIMIT_CLOSE';
  IF v_quantity<>65 OR v_reserved_close<>65 THEN
    RAISE EXCEPTION 'Unreserved Options MARKET SELL did not preserve LIMIT close reservation';
  END IF;

  v_result:=public.cancel_paper_option_limit_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('2',64)
  );
  IF v_result->>'status'<>'CANCELLED'
     OR (v_result->>'released_close_quantity')::integer<>65 THEN
    RAISE EXCEPTION 'Options SELL LIMIT cancel did not release close quantity: %',v_result;
  END IF;
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.execute_paper_long_option_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('6',64),
    'abababab-0000-4000-8000-000000000007',repeat('6',64),
    'NSE_FO|OPTION_LIMIT_CLOSE','OPTION_LIMIT_CLOSE',
    'NSE','NSE_FO','CE',current_date+5,25000,65,5,1,'SELL',1500,v_now,v_now
  );
  IF EXISTS(SELECT 1 FROM public.paper_derivative_positions
    WHERE user_id='abababab-abab-4bab-8bab-abababababab'
      AND instrument_key='NSE_FO|OPTION_LIMIT_CLOSE') THEN
    RAISE EXCEPTION 'Final MARKET close did not close the now-unreserved option position';
  END IF;

  -- Expiry releases the residual BUY reservation; missing verified session
  -- data is also a fail-closed expiry condition.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.submit_paper_option_limit_order(
    'abababab-abab-4bab-8bab-abababababab',repeat('7',64),
    'abababab-0000-4000-8000-000000000008',repeat('7',64),
    'NSE_FO|OPTION_LIMIT_EXPIRY','OPTION_LIMIT_EXPIRY','NSE','NSE_FO','PE',
    current_date+5,25000,65,5,'BUY',65,1250,v_now,clock_timestamp()+interval '1 second'
  );
  PERFORM pg_sleep(1.1);
  v_result:=public.expire_paper_option_limit_order(repeat('7',64));
  SELECT status INTO v_status FROM public.paper_option_limit_orders WHERE order_id=repeat('7',64);
  SELECT reserved_cash_paise INTO v_reserved_cash FROM public.paper_accounts
   WHERE user_id='abababab-abab-4bab-8bab-abababababab';
  IF v_status<>'EXPIRED' OR v_reserved_cash<>0
     OR (v_result->>'released_cash_paise')::bigint<>83646 THEN
    RAISE EXCEPTION 'Options LIMIT expiry did not release BUY cash reservation: %',v_result;
  END IF;
  v_result:=public.expire_paper_option_limit_order(repeat('7',64));
  IF (v_result->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Repeated Options LIMIT expiry was not idempotent';
  END IF;

  -- Least privilege: only service_role may call write RPCs.
  IF has_function_privilege('anon',
       'public.submit_paper_option_limit_order(uuid,text,uuid,text,text,text,text,text,text,date,numeric,integer,integer,text,integer,bigint,bigint,timestamp with time zone)',
       'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.cancel_paper_option_limit_order(uuid,text)','EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.expire_paper_option_limit_order(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Options LIMIT submit/cancel/expiry RPC grants are not least-privilege';
  END IF;
END
$options_limit_submit_release$;
ROLLBACK;
