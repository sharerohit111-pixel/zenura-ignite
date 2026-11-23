BEGIN;
SET LOCAL ROLE service_role;
SELECT public.import_paper_exchange_sessions(
  repeat('a',64),
  jsonb_build_array(
    jsonb_build_object('exchange','NSE','session_date',(now() at time zone 'Asia/Kolkata')::date,
      'is_trading_day',true,'open_minute',555,'close_minute',930,'session_kind','REGULAR',
      'source_reference','https://www.nseindia.com/market-data/holidays','verified_at',now()-interval '1 minute'),
    jsonb_build_object('exchange','BSE','session_date',(now() at time zone 'Asia/Kolkata')::date,
      'is_trading_day',true,'open_minute',555,'close_minute',930,'session_kind','REGULAR',
      'source_reference','https://www.bseindia.com/markets/market-info','verified_at',now()-interval '1 minute'),
    jsonb_build_object('exchange','BSE','session_date',(now() at time zone 'Asia/Kolkata')::date+1,
      'is_trading_day',true,'open_minute',600,'close_minute',900,'session_kind','SPECIAL',
      'source_reference','https://www.bseindia.com/notice','verified_at',now()-interval '1 minute'),
    jsonb_build_object('exchange','NSE','session_date',(now() at time zone 'Asia/Kolkata')::date+2,
      'is_trading_day',false,'open_minute',null,'close_minute',null,'session_kind','CLOSED',
      'source_reference','https://www.nseindia.com/holidays','verified_at',now()-interval '1 minute')
  )
);
RESET ROLE;

DO $exchange_session_import$
DECLARE
  v_date date:=(now() at time zone 'Asia/Kolkata')::date;
  v_count integer;
  v_hash text;
  v_rejected boolean;
BEGIN
  SELECT count(*) INTO v_count FROM public.paper_exchange_sessions
   WHERE (exchange='NSE' AND session_date=v_date)
      OR (exchange='BSE' AND session_date IN (v_date,v_date+1));
  IF v_count<>3 THEN RAISE EXCEPTION 'Expected three imported NSE/BSE session rows, found %',v_count; END IF;
  SELECT source_sha256 INTO v_hash FROM public.paper_exchange_sessions
   WHERE exchange='BSE' AND session_date=v_date;
  IF v_hash<>repeat('a',64) THEN RAISE EXCEPTION 'BSE session source hash was not retained'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.paper_exchange_sessions
    WHERE exchange='NSE' AND session_date=v_date+2
      AND is_trading_day=false AND session_kind='CLOSED'
      AND open_minute IS NULL AND close_minute IS NULL) THEN
    RAISE EXCEPTION 'Explicit closed NSE session was not imported';
  END IF;

  v_rejected:=false;
  BEGIN
    PERFORM public.import_paper_exchange_sessions(repeat('b',64),
      jsonb_build_array(jsonb_build_object('exchange','BSE','session_date',v_date,
        'is_trading_day',true,'open_minute',555,'close_minute',930,'session_kind','REGULAR',
        'source_reference','https://evil.example/bse','verified_at',now()-interval '1 minute')));
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Untrusted exchange source host was accepted'; END IF;

  v_rejected:=false;
  BEGIN
    PERFORM public.import_paper_exchange_sessions(repeat('c',64),
      jsonb_build_array(jsonb_build_object('exchange','NSE','session_date',v_date,
        'is_trading_day',true,'open_minute',540,'close_minute',930,'session_kind','REGULAR',
        'source_reference','https://www.nseindia.com/','verified_at',now()-interval '1 minute')));
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Invalid REGULAR NSE session window was accepted'; END IF;

  v_rejected:=false;
  BEGIN
    PERFORM public.import_paper_exchange_sessions(repeat('d',64),
      jsonb_build_array(jsonb_build_object('exchange','BSE','session_date',v_date,
        'is_trading_day',true,'open_minute',555,'close_minute',930,'session_kind','REGULAR',
        'source_reference','https://www.bseindia.com/','verified_at',now()+interval '1 hour')));
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Future-verified BSE session was accepted'; END IF;

  v_rejected:=false;
  BEGIN
    PERFORM public.import_paper_exchange_sessions(repeat('e',64),
      jsonb_build_array(
        jsonb_build_object('exchange','BSE','session_date',v_date+3,
          'is_trading_day',true,'open_minute',555,'close_minute',930,'session_kind','REGULAR',
          'source_reference','https://www.bseindia.com/','verified_at',now()-interval '1 minute'),
        jsonb_build_object('exchange','BSE','session_date',v_date+3,
          'is_trading_day',true,'open_minute',555,'close_minute',930,'session_kind','REGULAR',
          'source_reference','https://www.bseindia.com/','verified_at',now()-interval '1 minute')
      ));
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Duplicate BSE session dates were accepted'; END IF;

  v_rejected:=false;
  BEGIN
    PERFORM public.import_paper_exchange_sessions(repeat('f',64),
      jsonb_build_array(jsonb_build_object('exchange','NSE','session_date',v_date-8,
        'is_trading_day',true,'open_minute',555,'close_minute',930,'session_kind','REGULAR',
        'source_reference','https://www.nseindia.com/','verified_at',now()-interval '1 minute')));
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Stale NSE session date was accepted'; END IF;

  v_rejected:=false;
  BEGIN
    PERFORM public.import_paper_exchange_sessions(repeat('0',64),
      jsonb_build_array(jsonb_build_object('exchange','BSE','session_date',v_date,
        'is_trading_day',true,'open_minute',555,'close_minute',930,'session_kind','REGULAR',
        'source_reference','https://www.bseindia.com/','verified_at',now()-interval '2 minutes')));
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Older verified session revision overwrote the current row'; END IF;
END
$exchange_session_import$;
ROLLBACK;
