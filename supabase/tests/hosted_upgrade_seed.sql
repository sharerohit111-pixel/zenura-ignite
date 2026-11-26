-- Disposable hosted-baseline upgrade fixture.
-- Run after the exact 15 migrations already recorded by hosted Supabase and
-- before applying any of the 30 pending candidate migrations.
INSERT INTO auth.users(id)
VALUES ('e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1')
ON CONFLICT(id) DO NOTHING;

-- These rows model persisted legacy MARKET orders before the LIMIT lifecycle
-- columns exist. The subsequent migration chain must normalize terminal rows.
INSERT INTO public.paper_futures_orders(
  order_id,user_id,request_fingerprint,instrument_key,trading_symbol,
  exchange,segment,expiry,lot_size,side,product,order_type,status,quantity,
  execution_price_paise
) VALUES
  (repeat('e',64),'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',repeat('1',64),
   'NSE_FO|UPGRADE_FILLED','UPGRADE_FILLED','NSE','NSE_FO',current_date+30,25,
   'BUY','INTRADAY','MARKET','FILLED',5,1000),
  (repeat('f',64),'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',repeat('2',64),
   'NSE_FO|UPGRADE_CANCELLED','UPGRADE_CANCELLED','NSE','NSE_FO',current_date+30,25,
   'BUY','INTRADAY','MARKET','CANCELLED',5,null),
  (repeat('d',64),'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',repeat('3',64),
   'NSE_FO|UPGRADE_REJECTED','UPGRADE_REJECTED','NSE','NSE_FO',current_date+30,25,
   'BUY','INTRADAY','MARKET','REJECTED',5,null)
ON CONFLICT(order_id) DO NOTHING;
