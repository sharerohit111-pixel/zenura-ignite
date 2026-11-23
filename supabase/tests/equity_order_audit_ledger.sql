-- Exercise the deferred cash-equity order audit trigger with a disposable LIMIT fill.
BEGIN;
INSERT INTO auth.users(id)
VALUES ('77777777-7777-4777-8777-777777777777')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.paper_accounts(user_id,cash_paise,reserved_cash_paise,reserved_margin_paise)
VALUES ('77777777-7777-4777-8777-777777777777',100000,10010,0)
ON CONFLICT (user_id) DO UPDATE SET
  cash_paise=100000,reserved_cash_paise=10010,reserved_margin_paise=0;

INSERT INTO public.paper_orders(
  order_id,user_id,request_fingerprint,instrument_key,exchange,side,product,
  order_type,status,quantity,limit_price_paise,reserved_cash_paise,
  reserved_quantity,simulation_only
) VALUES (
  repeat('a',64),'77777777-7777-4777-8777-777777777777',repeat('b',64),
  'NSE_EQ|LEDGER_CI','NSE','BUY','DELIVERY','LIMIT','PENDING',1,10000,
  10010,0,true
);

SET CONSTRAINTS paper_equity_orders_audit_deferred IMMEDIATE;

DO $reservation_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.paper_equity_cash_ledger
     WHERE order_id=repeat('a',64)
       AND event_type='RESERVATION_CREATE'
       AND reserved_cash_delta_paise=10010
       AND reserved_cash_after_paise=10010
  ) THEN
    RAISE EXCEPTION 'LIMIT reservation was not recorded after submit';
  END IF;
END
$reservation_assertions$;

-- Simulate the same account/order mutations performed atomically by the fill RPC.
UPDATE public.paper_accounts
   SET cash_paise=89990,reserved_cash_paise=0,version=version+1
 WHERE user_id='77777777-7777-4777-8777-777777777777';

UPDATE public.paper_orders SET
  status='FILLED',execution_price_paise=10000,gross_paise=10000,
  charges_paise=10,charges_breakdown='{"indicative":true}'::jsonb,
  cash_delta_paise=-10010,realized_pnl_paise=0,quote_timestamp_ms=1000,
  quote_age_ms=0,reservation_released=true,filled_at=clock_timestamp(),
  updated_at=clock_timestamp()
WHERE order_id=repeat('a',64);

SET CONSTRAINTS paper_equity_orders_audit_deferred IMMEDIATE;

DO $fill_assertions$
DECLARE
  v_fill_count integer;
  v_trade_count integer;
  v_consume_count integer;
BEGIN
  SELECT count(*) INTO v_fill_count FROM public.paper_equity_fills
   WHERE order_id=repeat('a',64) AND quantity=1
     AND cash_delta_paise=-10010 AND charges_paise=10;
  SELECT count(*) INTO v_trade_count FROM public.paper_equity_cash_ledger
   WHERE order_id=repeat('a',64) AND event_type='TRADE_DEBIT'
     AND cash_delta_paise=-10010 AND cash_balance_after_paise=89990;
  SELECT count(*) INTO v_consume_count FROM public.paper_equity_cash_ledger
   WHERE order_id=repeat('a',64) AND event_type='RESERVATION_CONSUME'
     AND reserved_cash_delta_paise=-10010
     AND reserved_cash_after_paise=10010
     AND cash_balance_after_paise=100000;
  IF v_fill_count<>1 OR v_trade_count<>1 OR v_consume_count<>1 THEN
    RAISE EXCEPTION 'LIMIT fill audit mismatch: fills %, trades %, consumes %',
      v_fill_count,v_trade_count,v_consume_count;
  END IF;
END
$fill_assertions$;
ROLLBACK;
