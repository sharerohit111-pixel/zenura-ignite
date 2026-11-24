-- Disposable regression for atomic Delivery LIMIT fill/cash/reservation ledger writes.
BEGIN;
INSERT INTO auth.users(id) VALUES ('66666666-6666-4666-8666-666666666666')
ON CONFLICT (id) DO NOTHING;
SELECT public.initialize_paper_trading_account('66666666-6666-4666-8666-666666666666');

DO $delivery_limit_ledger$
DECLARE
  v_result jsonb;
  v_now_ms bigint;
  v_fills integer;
  v_ledger integer;
  v_cash bigint;
  v_reserved bigint;
BEGIN
  v_result:=public.submit_paper_limit_order(
    '66666666-6666-4666-8666-666666666666',repeat('e1',32),
    'aaaaaaaa-6666-4666-8666-666666666666',repeat('b',64),
    'NSE_EQ|DELIVERY_LIMIT_LEDGER','DELIVERY_LIMIT_LEDGER','NSE','BUY',10,10000
  );
  IF v_result->>'status'<>'PENDING' OR (v_result->>'reserved_cash_paise')::bigint<=0 THEN
    RAISE EXCEPTION 'Delivery LIMIT BUY did not create its expected reservation';
  END IF;
  v_now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_limit_fill(repeat('e1',32),9900,v_now_ms-500,500,v_now_ms);
  IF v_result->>'status'<>'FILLED' THEN
    RAISE EXCEPTION 'Delivery LIMIT BUY did not fill: %',v_result;
  END IF;
  SELECT cash_paise,reserved_cash_paise INTO v_cash,v_reserved
   FROM public.paper_accounts WHERE user_id='66666666-6666-4666-8666-666666666666';
  SELECT count(*) INTO v_fills FROM public.paper_equity_fills
   WHERE user_id='66666666-6666-4666-8666-666666666666' AND order_id=repeat('e1',32);
  SELECT count(*) INTO v_ledger FROM public.paper_equity_cash_ledger
   WHERE user_id='66666666-6666-4666-8666-666666666666' AND order_id=repeat('e1',32);
  IF v_fills<>1 OR v_ledger<>3 OR v_reserved<>0
     OR NOT EXISTS (SELECT 1 FROM public.paper_equity_fills
       WHERE order_id=repeat('e1',32) AND execution_id='limit:'||repeat('e1',32)
         AND quantity=10 AND cash_delta_paise<0)
     OR NOT EXISTS (SELECT 1 FROM public.paper_equity_cash_ledger
       WHERE order_id=repeat('e1',32) AND event_key='limit-reserve-create:'||repeat('e1',32)
         AND event_type='RESERVATION_CREATE' AND reserved_cash_delta_paise>0)
     OR NOT EXISTS (SELECT 1 FROM public.paper_equity_cash_ledger
       WHERE order_id=repeat('e1',32) AND event_key='limit-trade:'||repeat('e1',32)
         AND event_type='TRADE_DEBIT' AND cash_delta_paise<0)
     OR NOT EXISTS (SELECT 1 FROM public.paper_equity_cash_ledger
       WHERE order_id=repeat('e1',32) AND event_key='limit-reserve-consume:'||repeat('e1',32)
         AND event_type='RESERVATION_CONSUME' AND reserved_cash_delta_paise<0
         AND reserved_cash_after_paise=0) THEN
    RAISE EXCEPTION 'Delivery LIMIT BUY ledger/fill/reservation rows are inconsistent';
  END IF;

  v_result:=public.execute_paper_limit_fill(repeat('e1',32),9900,v_now_ms-500,500,v_now_ms);
  IF (v_result->>'already_filled')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Delivery LIMIT BUY retry was not idempotent';
  END IF;
  SELECT count(*) INTO v_fills FROM public.paper_equity_fills
   WHERE user_id='66666666-6666-4666-8666-666666666666' AND order_id=repeat('e1',32);
  SELECT count(*) INTO v_ledger FROM public.paper_equity_cash_ledger
   WHERE user_id='66666666-6666-4666-8666-666666666666' AND order_id=repeat('e1',32);
  IF v_fills<>1 OR v_ledger<>3 THEN
    RAISE EXCEPTION 'Delivery LIMIT BUY retry duplicated accounting rows';
  END IF;

  v_result:=public.submit_paper_limit_order(
    '66666666-6666-4666-8666-666666666666',repeat('f2',32),
    'cccccccc-6666-4666-8666-666666666666',repeat('d',64),
    'NSE_EQ|DELIVERY_LIMIT_LEDGER','DELIVERY_LIMIT_LEDGER','NSE','SELL',5,12000
  );
  v_now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_limit_fill(repeat('f2',32),12000,v_now_ms-500,500,v_now_ms);
  IF v_result->>'status'<>'FILLED' THEN
    RAISE EXCEPTION 'Delivery LIMIT SELL did not fill: %',v_result;
  END IF;
  SELECT count(*) INTO v_fills FROM public.paper_equity_fills
   WHERE user_id='66666666-6666-4666-8666-666666666666';
  SELECT count(*) INTO v_ledger FROM public.paper_equity_cash_ledger
   WHERE user_id='66666666-6666-4666-8666-666666666666';
  IF v_fills<>2 OR v_ledger<>4
     OR NOT EXISTS (SELECT 1 FROM public.paper_equity_fills
       WHERE order_id=repeat('f2',32) AND execution_id='limit:'||repeat('f2',32)
         AND side='SELL' AND cash_delta_paise>0)
     OR NOT EXISTS (SELECT 1 FROM public.paper_equity_cash_ledger
       WHERE order_id=repeat('f2',32) AND event_key='limit-trade:'||repeat('f2',32)
         AND event_type='TRADE_CREDIT' AND cash_delta_paise>0) THEN
    RAISE EXCEPTION 'Delivery LIMIT SELL ledger/fill rows are missing or inconsistent';
  END IF;
END
$delivery_limit_ledger$;
ROLLBACK;
