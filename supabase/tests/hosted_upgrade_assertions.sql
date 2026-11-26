-- Assert data that existed at the hosted 15-migration baseline survives
-- the forward upgrade with terminal Futures MARKET state normalized.
DO $hosted_upgrade_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.paper_futures_orders
     WHERE order_id=repeat('e',64) AND status='FILLED'
       AND filled_quantity=5 AND remaining_quantity=0
       AND average_fill_price_paise=1000
       AND reserved_open_margin_paise=0 AND reserved_close_quantity=0
  ) THEN
    RAISE EXCEPTION 'Hosted-baseline FILLED Futures MARKET row did not reconcile';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.paper_futures_orders
     WHERE order_id IN (repeat('f',64),repeat('d',64))
       AND (filled_quantity<>0 OR remaining_quantity<>0
         OR average_fill_price_paise IS NOT NULL
         OR reserved_open_margin_paise<>0 OR reserved_close_quantity<>0)
  ) THEN
    RAISE EXCEPTION 'Hosted-baseline terminal Futures MARKET row retained a LIMIT remainder';
  END IF;
END
$hosted_upgrade_assertions$;
