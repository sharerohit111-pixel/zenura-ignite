-- Delivery LIMIT full-fill + append-only ledger integration regression.
-- Runs only in the disposable PostgreSQL 17 CI database after the draft RPC integration.
BEGIN;

INSERT INTO auth.users(id)
VALUES ('33333333-3333-4333-8333-333333333333')
ON CONFLICT (id) DO NOTHING;
SELECT public.initialize_paper_trading_account('33333333-3333-4333-8333-333333333333');

INSERT INTO public.paper_equity_positions(
  user_id,product,instrument_key,trading_symbol,exchange,quantity,
  average_price_paise,cost_basis_paise,reserved_quantity
) VALUES (
  '33333333-3333-4333-8333-333333333333','DELIVERY',
  'NSE_EQ|DELIVERY_LIMIT_LEDGER_CI','DELIVERY_LIMIT_LEDGER_CI','NSE',
  5,10000,50000,0
);

DO $delivery_limit_ledger_checks$
DECLARE
  v_result jsonb;
  v_replay jsonb;
  v_now_ms bigint;
  v_cash bigint;
  v_reserved bigint;
  v_order_reserved bigint;
  v_fill_count integer;
  v_ledger_count integer;
BEGIN
  -- BUY: one fill, trade debit and reservation consumption; snapshots reconcile.
  v_result:=public.submit_paper_limit_order(
    '33333333-3333-4333-8333-333333333333',repeat('d',64),
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',repeat('1',64),
    'NSE_EQ|DELIVERY_LIMIT_LEDGER_CI','DELIVERY_LIMIT_LEDGER_CI',
    'NSE','BUY',2,10000
  );
  IF v_result->>'status'<>'PENDING' THEN
    RAISE EXCEPTION 'Delivery LIMIT BUY did not enter PENDING';
  END IF;
  SELECT reserved_cash_paise INTO v_order_reserved
    FROM public.paper_orders WHERE order_id=repeat('d',64);
  v_now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_limit_fill(
    repeat('d',64),9900,v_now_ms-1000,1000,v_now_ms
  );
  IF v_result->>'status'<>'FILLED' OR v_result->>'fill_id' IS NULL THEN
    RAISE EXCEPTION 'Delivery LIMIT BUY did not return a completed fill';
  END IF;
  SELECT cash_paise,reserved_cash_paise INTO v_cash,v_reserved
    FROM public.paper_accounts
   WHERE user_id='33333333-3333-4333-8333-333333333333';
  SELECT count(*) INTO v_fill_count FROM public.paper_equity_fills
   WHERE order_id=repeat('d',64);
  SELECT count(*) INTO v_ledger_count FROM public.paper_equity_cash_ledger
   WHERE order_id=repeat('d',64);
  IF v_fill_count<>1 OR v_ledger_count<>2
     OR (SELECT count(*) FROM public.paper_equity_cash_ledger
          WHERE order_id=repeat('d',64) AND event_type='TRADE_DEBIT')<>1
     OR (SELECT count(*) FROM public.paper_equity_cash_ledger
          WHERE order_id=repeat('d',64) AND event_type='RESERVATION_CONSUME')<>1
     OR (SELECT cash_delta_paise FROM public.paper_equity_cash_ledger
          WHERE order_id=repeat('d',64) AND event_type='TRADE_DEBIT')
          <>(v_result->>'cash_delta_paise')::bigint
     OR (SELECT cash_balance_after_paise FROM public.paper_equity_cash_ledger
          WHERE order_id=repeat('d',64) AND event_type='TRADE_DEBIT')<>v_cash
     OR (SELECT cash_balance_after_paise FROM public.paper_equity_cash_ledger
          WHERE order_id=repeat('d',64) AND event_type='RESERVATION_CONSUME')<>v_cash
     OR (SELECT reserved_cash_delta_paise FROM public.paper_equity_cash_ledger
          WHERE order_id=repeat('d',64) AND event_type='RESERVATION_CONSUME')<>-v_order_reserved
     OR (SELECT reserved_cash_after_paise FROM public.paper_equity_cash_ledger
          WHERE order_id=repeat('d',64) AND event_type='RESERVATION_CONSUME')<>v_reserved
     OR v_reserved<>0 THEN
    RAISE EXCEPTION 'Delivery LIMIT BUY fill/ledger/reservation snapshots do not reconcile';
  END IF;
  v_now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_replay:=public.execute_paper_limit_fill(
    repeat('d',64),9900,v_now_ms-1000,1000,v_now_ms
  );
  IF (v_replay->>'already_filled')::boolean IS NOT TRUE
     OR (SELECT count(*) FROM public.paper_equity_fills WHERE order_id=repeat('d',64))<>1
     OR (SELECT count(*) FROM public.paper_equity_cash_ledger WHERE order_id=repeat('d',64))<>2 THEN
    RAISE EXCEPTION 'Delivery LIMIT BUY replay duplicated fill or ledger events';
  END IF;

  -- SELL: one fill and one trade credit; no cash reservation-consume event.
  v_result:=public.submit_paper_limit_order(
    '33333333-3333-4333-8333-333333333333',repeat('e',64),
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',repeat('2',64),
    'NSE_EQ|DELIVERY_LIMIT_LEDGER_CI','DELIVERY_LIMIT_LEDGER_CI',
    'NSE','SELL',1,11000
  );
  IF v_result->>'status'<>'PENDING' THEN
    RAISE EXCEPTION 'Delivery LIMIT SELL did not enter PENDING';
  END IF;
  v_now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_limit_fill(
    repeat('e',64),11000,v_now_ms-1000,1000,v_now_ms
  );
  IF v_result->>'status'<>'FILLED' OR v_result->>'fill_id' IS NULL THEN
    RAISE EXCEPTION 'Delivery LIMIT SELL did not return a completed fill';
  END IF;
  SELECT cash_paise INTO v_cash FROM public.paper_accounts
   WHERE user_id='33333333-3333-4333-8333-333333333333';
  IF (SELECT count(*) FROM public.paper_equity_fills WHERE order_id=repeat('e',64))<>1
     OR (SELECT count(*) FROM public.paper_equity_cash_ledger WHERE order_id=repeat('e',64))<>1
     OR (SELECT count(*) FROM public.paper_equity_cash_ledger
          WHERE order_id=repeat('e',64) AND event_type='TRADE_CREDIT')<>1
     OR (SELECT count(*) FROM public.paper_equity_cash_ledger
          WHERE order_id=repeat('e',64) AND event_type='RESERVATION_CONSUME')<>0
     OR (SELECT cash_delta_paise FROM public.paper_equity_cash_ledger
          WHERE order_id=repeat('e',64) AND event_type='TRADE_CREDIT')
          <>(v_result->>'cash_delta_paise')::bigint
     OR (SELECT cash_balance_after_paise FROM public.paper_equity_cash_ledger
          WHERE order_id=repeat('e',64) AND event_type='TRADE_CREDIT')<>v_cash THEN
    RAISE EXCEPTION 'Delivery LIMIT SELL fill/credit ledger does not reconcile';
  END IF;
END
$delivery_limit_ledger_checks$;

ROLLBACK;
