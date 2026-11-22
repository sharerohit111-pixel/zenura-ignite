-- Intraday LIMIT reservation, idempotency, cancellation and session-expiry tests.
-- Runs only against the disposable PostgreSQL database in CI.
DO $intraday_limit_setup$
DECLARE
  v_now timestamptz:=clock_timestamp();
  v_date date:=(clock_timestamp() at time zone 'Asia/Kolkata')::date;
BEGIN
  INSERT INTO public.paper_exchange_sessions(
    exchange,session_date,is_trading_day,open_minute,close_minute,
    session_kind,source_reference,verified_at
  ) VALUES
    ('NSE',v_date,true,0,1440,'SPECIAL','CI verified session fixture',v_now),
    ('BSE',v_date,true,0,1440,'SPECIAL','CI verified session fixture',v_now)
  ON CONFLICT(exchange,session_date) DO UPDATE SET
    is_trading_day=excluded.is_trading_day,open_minute=excluded.open_minute,
    close_minute=excluded.close_minute,session_kind=excluded.session_kind,
    source_reference=excluded.source_reference,verified_at=excluded.verified_at;
  INSERT INTO public.paper_equity_positions(
    user_id,product,instrument_key,trading_symbol,exchange,quantity,
    average_price_paise,cost_basis_paise,reserved_quantity
  ) VALUES (
    '22222222-2222-4222-8222-222222222222','INTRADAY',
    'NSE_EQ|INTRA_LIMIT_CI','INTRA_LIMIT_CI','NSE',10,10000,100000,0
  ) ON CONFLICT(user_id,product,instrument_key) DO UPDATE SET
    quantity=10,average_price_paise=10000,cost_basis_paise=100000,reserved_quantity=0;
END
$intraday_limit_setup$;

DO $intraday_limit_checks$
DECLARE
  v_result jsonb;
  v_reserved bigint;
  v_qty integer;
  v_expired integer;
  v_now_ms bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
BEGIN
  IF NOT has_function_privilege('service_role',
       'public.submit_paper_intraday_limit_order(uuid,text,uuid,text,text,text,text,text,integer,bigint)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.submit_paper_intraday_limit_order(uuid,text,uuid,text,text,text,text,text,integer,bigint)','EXECUTE')
     OR has_function_privilege('anon',
       'public.expire_paper_intraday_limit_orders(integer)','EXECUTE') THEN
    RAISE EXCEPTION 'Intraday LIMIT RPC grants are not server-only';
  END IF;
  IF COALESCE(array_to_string((
    SELECT proconfig FROM pg_proc
    WHERE oid=to_regprocedure('public.submit_paper_intraday_limit_order(uuid,text,uuid,text,text,text,text,text,integer,bigint)')
  ),','),'') NOT LIKE '%search_path=""%' THEN
    RAISE EXCEPTION 'Intraday LIMIT submit RPC must pin empty search_path';
  END IF;

  v_result:=public.submit_paper_intraday_limit_order(
    '22222222-2222-4222-8222-222222222222',repeat('a',64),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('b',64),
    'NSE_EQ|INTRA_BUY_CI','INTRA_BUY_CI','NSE','BUY',2,10000
  );
  IF v_result->>'status'<>'PENDING' OR (v_result->>'reserved_cash_paise')::bigint<>20000 THEN
    RAISE EXCEPTION 'Intraday LIMIT BUY was not submitted with exact cash reservation';
  END IF;
  v_result:=public.submit_paper_intraday_limit_order(
    '22222222-2222-4222-8222-222222222222',repeat('a',64),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('b',64),
    'NSE_EQ|INTRA_BUY_CI','INTRA_BUY_CI','NSE','BUY',2,10000
  );
  IF (v_result->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Intraday LIMIT BUY replay was not idempotent';
  END IF;
  SELECT reserved_cash_paise INTO v_reserved FROM public.paper_accounts
   WHERE user_id='22222222-2222-4222-8222-222222222222';
  IF v_reserved<>20000 THEN RAISE EXCEPTION 'Intraday BUY retry double-reserved cash'; END IF;

  PERFORM public.cancel_paper_intraday_limit_order(
    '22222222-2222-4222-8222-222222222222',repeat('a',64)
  );
  SELECT reserved_cash_paise INTO v_reserved FROM public.paper_accounts
   WHERE user_id='22222222-2222-4222-8222-222222222222';
  IF v_reserved<>0 THEN RAISE EXCEPTION 'Intraday BUY cancellation did not release cash'; END IF;

  v_result:=public.submit_paper_intraday_limit_order(
    '22222222-2222-4222-8222-222222222222',repeat('c',64),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('d',64),
    'NSE_EQ|INTRA_LIMIT_CI','INTRA_LIMIT_CI','NSE','SELL',3,11000
  );
  SELECT reserved_quantity INTO v_qty FROM public.paper_equity_positions
   WHERE user_id='22222222-2222-4222-8222-222222222222'
     AND product='INTRADAY' AND instrument_key='NSE_EQ|INTRA_LIMIT_CI';
  IF v_qty<>3 THEN RAISE EXCEPTION 'Intraday SELL did not reserve shares'; END IF;
  PERFORM public.cancel_paper_intraday_limit_order(
    '22222222-2222-4222-8222-222222222222',repeat('c',64)
  );
  SELECT reserved_quantity INTO v_qty FROM public.paper_equity_positions
   WHERE user_id='22222222-2222-4222-8222-222222222222'
     AND product='INTRADAY' AND instrument_key='NSE_EQ|INTRA_LIMIT_CI';
  IF v_qty<>0 THEN RAISE EXCEPTION 'Intraday SELL cancellation did not release shares'; END IF;

  PERFORM public.submit_paper_intraday_limit_order(
    '22222222-2222-4222-8222-222222222222',repeat('e',64),
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',repeat('f',64),
    'NSE_EQ|INTRA_EXPIRE_CI','INTRA_EXPIRE_CI','NSE','BUY',1,12000
  );
  UPDATE public.paper_orders SET created_at=clock_timestamp()-interval '1 day'
   WHERE order_id=repeat('e',64);
  v_expired:=public.expire_paper_intraday_limit_orders(100);
  IF v_expired<>1 THEN RAISE EXCEPTION 'Previous-session Intraday LIMIT order was not expired'; END IF;
  SELECT reserved_cash_paise INTO v_reserved FROM public.paper_accounts
   WHERE user_id='22222222-2222-4222-8222-222222222222';
  IF v_reserved<>0 THEN RAISE EXCEPTION 'Intraday expiry did not release cash reservation'; END IF;
  IF (SELECT status FROM public.paper_orders WHERE order_id=repeat('e',64))<>'CANCELLED'
     OR (SELECT reservation_released FROM public.paper_orders WHERE order_id=repeat('e',64)) IS NOT TRUE THEN
    RAISE EXCEPTION 'Intraday expiry did not persist terminal cancellation state';
  END IF;

  BEGIN
    PERFORM public.submit_paper_intraday_limit_order(
      '22222222-2222-4222-8222-222222222222',repeat('9',64),
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',repeat('8',64),
      'NSE_EQ|BAD_EXCHANGE','BAD_EXCHANGE','MCX','BUY',1,10000
    );
    RAISE EXCEPTION 'Unsupported exchange was accepted for Intraday LIMIT';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END
$intraday_limit_checks$;

DELETE FROM public.paper_orders WHERE order_id IN (repeat('a',64),repeat('c',64),repeat('e',64));
DELETE FROM public.paper_equity_positions
 WHERE user_id='22222222-2222-4222-8222-222222222222'
   AND product='INTRADAY' AND instrument_key='NSE_EQ|INTRA_LIMIT_CI';
DELETE FROM public.paper_exchange_sessions
 WHERE source_reference='CI verified session fixture';
