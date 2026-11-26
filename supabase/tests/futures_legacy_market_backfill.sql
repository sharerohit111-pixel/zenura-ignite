-- Disposable regression for terminal legacy Futures MARKET rows.
BEGIN;
INSERT INTO auth.users(id)
VALUES ('abababab-abab-4bab-8bab-abababababab')
ON CONFLICT(id) DO NOTHING;

INSERT INTO public.paper_futures_orders(
  order_id,user_id,request_fingerprint,instrument_key,trading_symbol,
  exchange,segment,expiry,lot_size,side,product,order_type,status,quantity,
  execution_price_paise,filled_quantity,remaining_quantity,
  reserved_open_margin_paise,reserved_close_quantity
) VALUES
  (repeat('a',64),'abababab-abab-4bab-8bab-abababababab',repeat('1',64),
   'NSE_FO|LEGACY_FILLED','LEGACY_FILLED','NSE','NSE_FO',current_date+30,25,
   'BUY','INTRADAY','MARKET','FILLED',10,2500,0,0,0,0),
  (repeat('b',64),'abababab-abab-4bab-8bab-abababababab',repeat('2',64),
   'NSE_FO|LEGACY_CANCELLED','LEGACY_CANCELLED','NSE','NSE_FO',current_date+30,25,
   'BUY','INTRADAY','MARKET','CANCELLED',10,null,0,0,0,0),
  (repeat('c',64),'abababab-abab-4bab-8bab-abababababab',repeat('3',64),
   'NSE_FO|LEGACY_REJECTED','LEGACY_REJECTED','NSE','NSE_FO',current_date+30,25,
   'BUY','INTRADAY','MARKET','REJECTED',10,null,0,0,0,0)
ON CONFLICT(order_id) DO NOTHING;

-- Re-run the exact idempotent backfill statement from the corrective migration
-- against representative rows in their pre-backfill state.
UPDATE public.paper_futures_orders
   SET filled_quantity=case when status='FILLED' then quantity else 0 end,
       remaining_quantity=0,
       average_fill_price_paise=case when status='FILLED' then execution_price_paise else null end,
       reserved_open_margin_paise=0,
       reserved_close_quantity=0
 WHERE order_id IN (repeat('a',64),repeat('b',64),repeat('c',64))
   AND order_type='MARKET';

DO $assert_legacy_market$
BEGIN
  IF (SELECT filled_quantity FROM public.paper_futures_orders WHERE order_id=repeat('a',64))<>10
     OR (SELECT remaining_quantity FROM public.paper_futures_orders WHERE order_id=repeat('a',64))<>0 THEN
    RAISE EXCEPTION 'FILLED legacy MARKET row was not backfilled as terminal';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.paper_futures_orders
     WHERE order_id IN (repeat('b',64),repeat('c',64))
       AND (filled_quantity<>0 OR remaining_quantity<>0
         OR average_fill_price_paise IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'CANCELLED/REJECTED legacy MARKET row retained an open remainder';
  END IF;
END
$assert_legacy_market$;
ROLLBACK;
