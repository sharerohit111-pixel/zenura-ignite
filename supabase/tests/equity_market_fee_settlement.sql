-- Disposable PostgreSQL regression for atomic NSE cash-equity MARKET charges.
-- Runs only in the CI fixture database; all fixture rows are rolled back.
BEGIN;
INSERT INTO auth.users(id) VALUES ('55555555-5555-4555-8555-555555555555')
ON CONFLICT (id) DO NOTHING;
SELECT public.initialize_paper_trading_account('55555555-5555-4555-8555-555555555555');
DO $equity_market_fee_checks$
DECLARE
  v_result jsonb;
  v_cash bigint;
  v_basis bigint;
  v_qty integer;
  v_charges bigint;
  v_realized bigint;
  v_order public.paper_orders%rowtype;
  v_order_delivery_buy text := md5('zenura:equity-market-fee:delivery-buy') || md5('zenura:equity-market-fee:delivery-buy:v2');
  v_order_delivery_sell text := md5('zenura:equity-market-fee:delivery-sell') || md5('zenura:equity-market-fee:delivery-sell:v2');
  v_order_intraday_buy text := md5('zenura:equity-market-fee:intraday-buy') || md5('zenura:equity-market-fee:intraday-buy:v2');
  v_order_intraday_sell text := md5('zenura:equity-market-fee:intraday-sell') || md5('zenura:equity-market-fee:intraday-sell:v2');
  v_order_tiny_sell text := md5('zenura:equity-market-fee:tiny-sell') || md5('zenura:equity-market-fee:tiny-sell:v2');
  v_order_bse_invalid text := md5('zenura:equity-market-fee:bse-invalid') || md5('zenura:equity-market-fee:bse-invalid:v2');
BEGIN
  -- NSE Delivery BUY: gross ₹1,000; fee-inclusive debit ₹1,024.79.
  v_result:=public.execute_paper_market_order(
    '55555555-5555-4555-8555-555555555555',v_order_delivery_buy,
    'aaaaaaaa-5555-4555-8555-555555555555',repeat('b',64),
    'NSE_EQ|FEE_DELIVERY','FEEDEL','NSE','BUY','DELIVERY',10,10000,
    floor(extract(epoch from clock_timestamp())*1000)::bigint,0
  );
  SELECT cash_paise INTO v_cash FROM public.paper_accounts
   WHERE user_id='55555555-5555-4555-8555-555555555555';
  SELECT cost_basis_paise,quantity INTO v_basis,v_qty FROM public.paper_equity_positions
   WHERE user_id='55555555-5555-4555-8555-555555555555'
     AND product='DELIVERY' AND instrument_key='NSE_EQ|FEE_DELIVERY';
  SELECT * INTO v_order FROM public.paper_orders WHERE order_id=v_order_delivery_buy;
  IF v_result->>'status'<>'FILLED' OR v_result->>'cash_paise' IS NULL
     OR v_cash<>99897521 OR v_basis<>102479 OR v_qty<>10
     OR v_order.gross_paise<>100000 OR v_order.charges_paise<>2479
     OR v_order.cash_delta_paise<>-102479
     OR v_order.charges_breakdown->>'schedule_version'<>'2026-03-01'
     OR v_order.charges_breakdown->>'indicative'<>'true' THEN
    RAISE EXCEPTION 'Delivery BUY mismatch: cash %, basis %, qty %, gross %, charges %, delta %, breakdown %, result %',
      v_cash,v_basis,v_qty,v_order.gross_paise,v_order.charges_paise,v_order.cash_delta_paise,
      v_order.charges_breakdown,v_result;
  END IF;
  -- Same idempotency key returns the stored charge snapshot without another debit.
  v_result:=public.execute_paper_market_order(
    '55555555-5555-4555-8555-555555555555',v_order_delivery_buy,
    'aaaaaaaa-5555-4555-8555-555555555555',repeat('b',64),
    'NSE_EQ|FEE_DELIVERY','FEEDEL','NSE','BUY','DELIVERY',10,10000,
    floor(extract(epoch from clock_timestamp())*1000)::bigint,0
  );
  SELECT cash_paise INTO v_cash FROM public.paper_accounts
   WHERE user_id='55555555-5555-4555-8555-555555555555';
  IF (v_result->>'idempotent_replay')::boolean IS NOT TRUE
     OR (v_result->>'charges_paise')::bigint<>2479 OR v_cash<>99897521 THEN
    RAISE EXCEPTION 'Delivery BUY replay did not preserve the exact fee snapshot';
  END IF;

  -- Delivery SELL: STT and DP reduce proceeds; realized P&L is net of both legs' costs.
  v_result:=public.execute_paper_market_order(
    '55555555-5555-4555-8555-555555555555',v_order_delivery_sell,
    'cccccccc-5555-4555-8555-555555555555',repeat('d',64),
    'NSE_EQ|FEE_DELIVERY','FEEDEL','NSE','SELL','DELIVERY',5,12000,
    floor(extract(epoch from clock_timestamp())*1000)::bigint,0
  );
  SELECT cash_paise,realized_pnl_paise INTO v_cash,v_realized FROM public.paper_accounts
   WHERE user_id='55555555-5555-4555-8555-555555555555';
  SELECT cost_basis_paise,quantity INTO v_basis,v_qty FROM public.paper_equity_positions
   WHERE user_id='55555555-5555-4555-8555-555555555555'
     AND product='DELIVERY' AND instrument_key='NSE_EQ|FEE_DELIVERY';
  SELECT charges_paise INTO v_charges FROM public.paper_orders WHERE order_id=v_order_delivery_sell;
  IF v_cash<>99952739 OR v_basis<>51239 OR v_qty<>5
     OR v_charges<>4782 OR v_realized<>3978
     OR (v_result->>'order_realized_pnl_paise')::bigint<>3978 THEN
    RAISE EXCEPTION 'Delivery SELL net proceeds, cost basis allocation or realized P&L mismatch';
  END IF;

  -- Intraday BUY and SELL use intraday STT/stamp rules and still settle atomically.
  PERFORM public.execute_paper_market_order(
    '55555555-5555-4555-8555-555555555555',v_order_intraday_buy,
    'eeeeeeee-5555-4555-8555-555555555555',repeat('f',64),
    'NSE_EQ|FEE_INTRADAY','FEEINTRA','NSE','BUY','INTRADAY',10,10000,
    floor(extract(epoch from clock_timestamp())*1000)::bigint,0
  );
  SELECT charges_paise INTO v_charges FROM public.paper_orders WHERE order_id=v_order_intraday_buy;
  IF v_charges<>125 THEN RAISE EXCEPTION 'Intraday BUY fee schedule mismatch'; END IF;
  v_result:=public.execute_paper_market_order(
    '55555555-5555-4555-8555-555555555555',v_order_intraday_sell,
    '11111111-5555-4555-8555-555555555555',repeat('2',64),
    'NSE_EQ|FEE_INTRADAY','FEEINTRA','NSE','SELL','INTRADAY',10,10000,
    floor(extract(epoch from clock_timestamp())*1000)::bigint,0
  );
  SELECT cash_paise,realized_pnl_paise INTO v_cash,v_realized FROM public.paper_accounts
   WHERE user_id='55555555-5555-4555-8555-555555555555';
  SELECT charges_paise INTO v_charges FROM public.paper_orders WHERE order_id=v_order_intraday_sell;
  IF v_charges<>147 OR v_cash<>99952467 OR v_realized<>3706
     OR (v_result->>'order_realized_pnl_paise')::bigint<>-272 THEN
    RAISE EXCEPTION 'Intraday SELL fee-inclusive cash or realized P&L mismatch';
  END IF;

  -- Tiny NSE SELLs whose minimum brokerage exceeds gross proceeds must fail closed.
  BEGIN
    PERFORM public.execute_paper_market_order(
      '55555555-5555-4555-8555-555555555555',v_order_tiny_sell,
      '99999999-5555-4555-8555-555555555555',repeat('8',64),
      'NSE_EQ|FEE_DELIVERY','FEEDEL','NSE','SELL','DELIVERY',1,1,
      floor(extract(epoch from clock_timestamp())*1000)::bigint,0
    );
    RAISE EXCEPTION 'Tiny NSE SELL with negative net proceeds was accepted';
  EXCEPTION WHEN SQLSTATE '22003' THEN
    NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.paper_orders WHERE order_id=v_order_tiny_sell) THEN
    RAISE EXCEPTION 'Rejected tiny NSE SELL left a persisted order row';
  END IF;

  -- Unsupported BSE cash scrip fee classification is rejected before any mutation.
  BEGIN
    PERFORM public.execute_paper_market_order(
      '55555555-5555-4555-8555-555555555555',v_order_bse_invalid,
      '33333333-5555-4555-8555-555555555555',repeat('4',64),
      'BSE_EQ|UNCLASSIFIED','BSETEST','BSE','BUY','DELIVERY',1,10000,
      floor(extract(epoch from clock_timestamp())*1000)::bigint,0
    );
    RAISE EXCEPTION 'BSE cash order was accepted without scrip-group fee inputs';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.paper_orders WHERE order_id=v_order_bse_invalid) THEN
    RAISE EXCEPTION 'Rejected BSE cash order left a persisted order row';
  END IF;
END
$equity_market_fee_checks$;
ROLLBACK;
