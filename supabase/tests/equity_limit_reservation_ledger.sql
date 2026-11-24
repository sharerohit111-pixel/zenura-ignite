-- Disposable regression for atomic NSE Equity LIMIT cash reservation ledger events.
BEGIN;
INSERT INTO auth.users(id) VALUES ('88888888-8888-4888-8888-888888888888')
ON CONFLICT (id) DO NOTHING;
SELECT public.initialize_paper_trading_account('88888888-8888-4888-8888-888888888888');

INSERT INTO public.paper_exchange_sessions(
  exchange,session_date,is_trading_day,open_minute,close_minute,session_kind,
  source_reference,verified_at,source_sha256
) VALUES (
  'NSE',(clock_timestamp() at time zone 'Asia/Kolkata')::date,true,0,1440,'SPECIAL',
  'CI verified reservation-ledger session',clock_timestamp(),repeat('8',64)
)
ON CONFLICT(exchange,session_date) DO UPDATE SET
  is_trading_day=excluded.is_trading_day,open_minute=excluded.open_minute,
  close_minute=excluded.close_minute,session_kind=excluded.session_kind,
  source_reference=excluded.source_reference,verified_at=excluded.verified_at,
  source_sha256=excluded.source_sha256;

DO $equity_reservation_ledger$
DECLARE
  v_result jsonb;
  v_reserved bigint;
  v_cash bigint;
  v_count integer;
  v_expired integer;
BEGIN
  -- Delivery BUY: reservation creation is recorded with the same account snapshot.
  v_result:=public.submit_paper_limit_order(
    '88888888-8888-4888-8888-888888888888','deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    'aaaaaaaa-8888-4888-8888-888888888888',repeat('b',64),
    'NSE_EQ|RESERVE_DELIVERY','RESERVE_DELIVERY','NSE','BUY',2,10000
  );
  SELECT cash_paise,reserved_cash_paise INTO v_cash,v_reserved
   FROM public.paper_accounts WHERE user_id='88888888-8888-4888-8888-888888888888';
  IF NOT EXISTS(SELECT 1 FROM public.paper_equity_cash_ledger
     WHERE order_id='deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' AND event_key='limit-reserve-create:'||'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
       AND event_type='RESERVATION_CREATE' AND cash_delta_paise=0
       AND reserved_cash_delta_paise>0
       AND cash_balance_after_paise=v_cash AND reserved_cash_after_paise=v_reserved) THEN
    RAISE EXCEPTION 'Delivery LIMIT BUY reservation creation was not recorded atomically';
  END IF;

  -- Cancellation releases exactly the same reservation, once only.
  PERFORM public.cancel_paper_limit_order(
    '88888888-8888-4888-8888-888888888888','deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
  );
  PERFORM public.cancel_paper_limit_order(
    '88888888-8888-4888-8888-888888888888','deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
  );
  SELECT reserved_cash_paise INTO v_reserved FROM public.paper_accounts
   WHERE user_id='88888888-8888-4888-8888-888888888888';
  SELECT count(*) INTO v_count FROM public.paper_equity_cash_ledger
   WHERE order_id='deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' AND event_type='RESERVATION_RELEASE';
  IF v_reserved<>0 OR v_count<>1
     OR NOT EXISTS(SELECT 1 FROM public.paper_equity_cash_ledger
       WHERE order_id='deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' AND event_key='limit-reserve-release:'||'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
         AND reserved_cash_delta_paise<0 AND reserved_cash_after_paise=0) THEN
    RAISE EXCEPTION 'Delivery LIMIT BUY cancellation release missing, duplicated or inconsistent';
  END IF;

  -- Intraday BUY: session expiry must write the matching release event.
  PERFORM public.submit_paper_intraday_limit_order(
    '88888888-8888-4888-8888-888888888888','cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe',
    'cccccccc-8888-4888-8888-888888888888',repeat('d',64),
    'NSE_EQ|RESERVE_INTRADAY','RESERVE_INTRADAY','NSE','BUY',1,10000
  );
  UPDATE public.paper_orders SET created_at=clock_timestamp()-interval '1 day'
   WHERE order_id='cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe';
  v_expired:=public.expire_paper_intraday_limit_orders(100);
  SELECT reserved_cash_paise INTO v_reserved FROM public.paper_accounts
   WHERE user_id='88888888-8888-4888-8888-888888888888';
  SELECT count(*) INTO v_count FROM public.paper_equity_cash_ledger
   WHERE order_id='cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe' AND event_type='RESERVATION_RELEASE';
  IF v_expired<>1 OR v_reserved<>0 OR v_count<>1
     OR NOT EXISTS(SELECT 1 FROM public.paper_equity_cash_ledger
       WHERE order_id='cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe'
         AND event_key='intraday-limit-reserve-release:'||'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe'
         AND event_type='RESERVATION_RELEASE' AND reserved_cash_delta_paise<0
         AND metadata->>'reason'='SESSION_EXPIRY') THEN
    RAISE EXCEPTION 'Intraday LIMIT expiry did not record exactly one cash reservation release';
  END IF;

  RAISE NOTICE 'Reservation lifecycle cash events verified';
END
$equity_reservation_ledger$;

ROLLBACK;
