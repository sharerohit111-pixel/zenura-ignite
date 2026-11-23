-- Disposable PostgreSQL regression: early expiry must fail closed without a verified session.
BEGIN;

INSERT INTO auth.users(id)
VALUES ('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1')
ON CONFLICT(id) DO NOTHING;
SELECT public.initialize_paper_trading_account('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1');

INSERT INTO public.paper_exchange_sessions(
  exchange,session_date,is_trading_day,open_minute,close_minute,
  session_kind,source_reference,verified_at,source_sha256
) VALUES (
  'NSE',(clock_timestamp() at time zone 'Asia/Kolkata')::date,
  true,0,1440,'SPECIAL','https://www.nseindia.com/market-data/holidays',
  clock_timestamp(),repeat('f',64)
)
ON CONFLICT(exchange,session_date) DO UPDATE SET
  is_trading_day=true,open_minute=0,close_minute=1440,
  session_kind='SPECIAL',source_reference='https://www.nseindia.com/market-data/holidays',
  verified_at=clock_timestamp(),source_sha256=repeat('f',64);

DO $expiry_calendar_guard$
DECLARE
  v_now bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_minute integer;
  v_result jsonb;
  v_rejected boolean;
  v_reserved bigint;
  v_status text;
BEGIN
  PERFORM public.submit_paper_option_limit_order(
    'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',repeat('f',64),
    'f1f1f1f1-0000-4000-8000-000000000001',repeat('a',64),
    'NSE_FO|OPTION_EXPIRY_CALENDAR','OPTION_EXPIRY_CALENDAR',
    'NSE','NSE_FO','CE',(clock_timestamp() at time zone 'Asia/Kolkata')::date+5,
    25000,65,5,'BUY',65,1250,v_now,clock_timestamp()+interval '1 hour'
  );

  -- No calendar row: early expiry must leave both order and cash reservation untouched.
  DELETE FROM public.paper_exchange_sessions
   WHERE exchange='NSE'
     AND session_date=(clock_timestamp() at time zone 'Asia/Kolkata')::date;
  v_rejected:=false;
  BEGIN
    PERFORM public.expire_paper_option_limit_order(repeat('f',64));
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected:=true;
  END;
  SELECT status INTO v_status FROM public.paper_option_limit_orders WHERE order_id=repeat('f',64);
  SELECT reserved_cash_paise INTO v_reserved FROM public.paper_accounts
   WHERE user_id='f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';
  IF NOT v_rejected OR v_status<>'PENDING' OR v_reserved<=0 THEN
    RAISE EXCEPTION 'Missing verified NSE session released an unexpired Options reservation';
  END IF;

  -- A verified open session must also keep the pending order and reservation.
  INSERT INTO public.paper_exchange_sessions(
    exchange,session_date,is_trading_day,open_minute,close_minute,
    session_kind,source_reference,verified_at,source_sha256
  ) VALUES (
    'NSE',(clock_timestamp() at time zone 'Asia/Kolkata')::date,
    true,0,1440,'SPECIAL','https://www.nseindia.com/market-data/holidays',
    clock_timestamp(),repeat('f',64)
  );
  v_rejected:=false;
  BEGIN
    PERFORM public.expire_paper_option_limit_order(repeat('f',64));
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected:=true;
  END;
  SELECT status INTO v_status FROM public.paper_option_limit_orders WHERE order_id=repeat('f',64);
  IF NOT v_rejected OR v_status<>'PENDING' THEN
    RAISE EXCEPTION 'Verified open NSE session did not preserve the pending Options order';
  END IF;

  -- After the verified session close, expiry may release the remaining reservation.
  v_minute:=extract(hour from (clock_timestamp() at time zone 'Asia/Kolkata'))::integer*60
    +extract(minute from (clock_timestamp() at time zone 'Asia/Kolkata'))::integer;
  IF v_minute<1 THEN
    RAISE EXCEPTION 'This regression requires a local time after 00:01 IST';
  END IF;
  UPDATE public.paper_exchange_sessions
     SET open_minute=0,close_minute=v_minute,verified_at=clock_timestamp()
   WHERE exchange='NSE'
     AND session_date=(clock_timestamp() at time zone 'Asia/Kolkata')::date;
  v_result:=public.expire_paper_option_limit_order(repeat('f',64));
  SELECT status INTO v_status FROM public.paper_option_limit_orders WHERE order_id=repeat('f',64);
  SELECT reserved_cash_paise INTO v_reserved FROM public.paper_accounts
   WHERE user_id='f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';
  IF v_status<>'EXPIRED' OR v_reserved<>0
     OR (v_result->>'released_cash_paise')::bigint<=0 THEN
    RAISE EXCEPTION 'Verified post-session expiry did not release the remaining Options reservation';
  END IF;
END
$expiry_calendar_guard$;

ROLLBACK;
