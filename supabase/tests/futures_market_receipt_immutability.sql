-- Disposable PostgreSQL regression for immutable Futures MARKET receipts.
-- LIMIT lifecycle rows remain mutable. All fixture rows are rolled back.
BEGIN;
INSERT INTO auth.users(id) VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
ON CONFLICT (id) DO NOTHING;
SELECT public.initialize_paper_trading_account('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

DO $futures_receipt_immutable$
DECLARE
  v_now bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result jsonb;
  v_rejected boolean;
BEGIN
  v_result:=public.execute_paper_futures_market_order(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',repeat('e',64),
    'eeeeeeee-0000-4000-8000-000000000001',repeat('a',64),
    'NSE_FO|IMMUTABLE_TEST','IMMUTABLE_TEST','NSE','NSE_FO',current_date+5,
    25,5,'BUY','DELIVERY',25,10000,100000,100,v_now,v_now
  );
  IF v_result->>'status'<>'FILLED' THEN
    RAISE EXCEPTION 'Futures MARKET receipt fixture did not fill';
  END IF;

  v_rejected:=false;
  BEGIN
    UPDATE public.paper_futures_orders
       SET charges_paise=charges_paise+1
     WHERE order_id=repeat('e',64);
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected:=true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Completed Futures MARKET receipt accepted UPDATE';
  END IF;

  v_rejected:=false;
  BEGIN
    DELETE FROM public.paper_futures_orders WHERE order_id=repeat('e',64);
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected:=true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Completed Futures MARKET receipt accepted DELETE';
  END IF;

  IF (SELECT count(*) FROM public.paper_futures_orders
       WHERE order_id=repeat('e',64) AND status='FILLED'
         AND order_type='MARKET' AND charges_paise=100)<>1 THEN
    RAISE EXCEPTION 'Rejected mutation changed the MARKET receipt';
  END IF;

  -- A pending LIMIT order must remain mutable for its normal lifecycle.
  INSERT INTO public.paper_futures_orders(
    order_id,user_id,request_fingerprint,instrument_key,trading_symbol,
    exchange,segment,expiry,lot_size,side,product,order_type,status,
    quantity,limit_price_paise
  ) VALUES (
    repeat('d',64),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',repeat('b',64),
    'NSE_FO|LIMIT_IMMUTABLE_TEST','LIMIT_IMMUTABLE_TEST',
    'NSE','NSE_FO',current_date+5,25,'BUY','DELIVERY','LIMIT','PENDING',
    25,10000
  );
  UPDATE public.paper_futures_orders
     SET status='CANCELLED',cancelled_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE order_id=repeat('d',64);
  IF (SELECT status FROM public.paper_futures_orders
       WHERE order_id=repeat('d',64))<>'CANCELLED' THEN
    RAISE EXCEPTION 'Futures LIMIT cancellation lifecycle was blocked';
  END IF;
END
$futures_receipt_immutable$;
ROLLBACK;
