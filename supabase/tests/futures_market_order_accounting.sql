-- Disposable PostgreSQL regression for futures close/reversal and fail-closed accounting.
-- Runs only in the CI fixture database; all fixture rows are rolled back.
BEGIN;
INSERT INTO auth.users(id) VALUES ('fefefefe-fefe-4efe-8efe-fefefefefefe')
ON CONFLICT (id) DO NOTHING;
SELECT public.initialize_paper_trading_account('fefefefe-fefe-4efe-8efe-fefefefefefe');

DO $futures_accounting$
DECLARE
  v_now bigint;
  v_result jsonb;
  v_qty integer;
  v_margin bigint;
  v_position_realized bigint;
  v_account_margin bigint;
  v_account_realized bigint;
  v_cash bigint;
  v_rejected boolean;
BEGIN
  -- Open 50 contracts (two 25-unit lots).
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_futures_market_order(
    'fefefefe-fefe-4efe-8efe-fefefefefefe',repeat('a',64),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('b',64),
    'NSE_FO|FUT_CLOSE_TEST','FUT_CLOSE_TEST','NSE','NSE_FO',current_date+5,
    25,5,'BUY','DELIVERY',50,10000,200000,1000,v_now,v_now
  );
  IF (v_result->>'cash_paise')::bigint<>99999000
     OR (v_result->>'reserved_margin_paise')::bigint<>200000 THEN
    RAISE EXCEPTION 'Futures open accounting mismatch: %',v_result;
  END IF;

  -- An exact replay must not debit charges or reserve margin a second time.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_futures_market_order(
    'fefefefe-fefe-4efe-8efe-fefefefefefe',repeat('a',64),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('b',64),
    'NSE_FO|FUT_CLOSE_TEST','FUT_CLOSE_TEST','NSE','NSE_FO',current_date+5,
    25,5,'BUY','DELIVERY',50,10000,200000,1000,v_now,v_now
  );
  IF (v_result->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Futures exact retry was not idempotent';
  END IF;

  -- Reusing the same key with a different fingerprint must fail before mutation.
  v_rejected:=false;
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  BEGIN
    PERFORM public.execute_paper_futures_market_order(
      'fefefefe-fefe-4efe-8efe-fefefefefefe',repeat('a',64),
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('c',64),
      'NSE_FO|FUT_CLOSE_TEST','FUT_CLOSE_TEST','NSE','NSE_FO',current_date+5,
      25,5,'BUY','DELIVERY',50,10000,200000,1000,v_now,v_now
    );
  EXCEPTION WHEN SQLSTATE '23505' THEN
    v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Changed futures retry payload was accepted'; END IF;

  -- Partial close releases exactly half the original margin and realizes gross P&L.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.execute_paper_futures_market_order(
    'fefefefe-fefe-4efe-8efe-fefefefefefe',repeat('c',64),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('d',64),
    'NSE_FO|FUT_CLOSE_TEST','FUT_CLOSE_TEST','NSE','NSE_FO',current_date+5,
    25,5,'SELL','DELIVERY',25,12000,0,1000,v_now,v_now
  );
  SELECT net_quantity,reserved_margin_paise,realized_pnl_paise
    INTO v_qty,v_margin,v_position_realized
    FROM public.paper_futures_positions
   WHERE user_id='fefefefe-fefe-4efe-8efe-fefefefefefe'
     AND instrument_key='NSE_FO|FUT_CLOSE_TEST';
  SELECT reserved_margin_paise,realized_pnl_paise,cash_paise
    INTO v_account_margin,v_account_realized,v_cash
    FROM public.paper_accounts
   WHERE user_id='fefefefe-fefe-4efe-8efe-fefefefefefe';
  IF v_qty<>25 OR v_margin<>100000 OR v_position_realized<>50000
     OR v_account_margin<>100000 OR v_account_realized<>50000
     OR v_cash<>100048000 THEN
    RAISE EXCEPTION 'Futures partial close mismatch: qty %, position margin %, position P&L %, account margin %, account P&L %, cash %',
      v_qty,v_margin,v_position_realized,v_account_margin,v_account_realized,v_cash;
  END IF;

  -- Final close releases the entire remaining margin and removes the flat position.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.execute_paper_futures_market_order(
    'fefefefe-fefe-4efe-8efe-fefefefefefe',repeat('e',64),
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',repeat('f',64),
    'NSE_FO|FUT_CLOSE_TEST','FUT_CLOSE_TEST','NSE','NSE_FO',current_date+5,
    25,5,'SELL','DELIVERY',25,9000,0,1000,v_now,v_now
  );
  SELECT reserved_margin_paise,realized_pnl_paise,cash_paise
    INTO v_account_margin,v_account_realized,v_cash
    FROM public.paper_accounts
   WHERE user_id='fefefefe-fefe-4efe-8efe-fefefefefefe';
  IF EXISTS(SELECT 1 FROM public.paper_futures_positions
      WHERE user_id='fefefefe-fefe-4efe-8efe-fefefefefefe'
        AND instrument_key='NSE_FO|FUT_CLOSE_TEST')
     OR v_account_margin<>0 OR v_account_realized<>25000 OR v_cash<>100022000 THEN
    RAISE EXCEPTION 'Futures full close did not release all margin or reconcile P&L/cash';
  END IF;

  -- Reopen long, then cross through zero into a short position.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.execute_paper_futures_market_order(
    'fefefefe-fefe-4efe-8efe-fefefefefefe',repeat('1',64),
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',repeat('2',64),
    'NSE_FO|FUT_CLOSE_TEST','FUT_CLOSE_TEST','NSE','NSE_FO',current_date+5,
    25,5,'BUY','DELIVERY',50,10000,200000,1000,v_now,v_now
  );
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.execute_paper_futures_market_order(
    'fefefefe-fefe-4efe-8efe-fefefefefefe',repeat('3',64),
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',repeat('4',64),
    'NSE_FO|FUT_CLOSE_TEST','FUT_CLOSE_TEST','NSE','NSE_FO',current_date+5,
    25,5,'SELL','DELIVERY',75,11000,125000,1000,v_now,v_now
  );
  SELECT net_quantity,reserved_margin_paise,average_price_paise,realized_pnl_paise
    INTO v_qty,v_margin,v_cash,v_position_realized
    FROM public.paper_futures_positions
   WHERE user_id='fefefefe-fefe-4efe-8efe-fefefefefefe'
     AND instrument_key='NSE_FO|FUT_CLOSE_TEST';
  IF v_qty<>-25 OR v_margin<>125000 OR v_cash<>11000 OR v_position_realized<>50000 THEN
    RAISE EXCEPTION 'Futures long-to-short reversal mismatch: qty %, margin %, avg %, realized %',
      v_qty,v_margin,v_cash,v_position_realized;
  END IF;

  -- Closing the short releases its remaining margin and books the short-side loss.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  PERFORM public.execute_paper_futures_market_order(
    'fefefefe-fefe-4efe-8efe-fefefefefefe',repeat('5',64),
    'ffffffff-ffff-4fff-8fff-ffffffffffff',repeat('6',64),
    'NSE_FO|FUT_CLOSE_TEST','FUT_CLOSE_TEST','NSE','NSE_FO',current_date+5,
    25,5,'BUY','DELIVERY',25,12000,0,1000,v_now,v_now
  );
  SELECT reserved_margin_paise,realized_pnl_paise,cash_paise
    INTO v_account_margin,v_account_realized,v_cash
    FROM public.paper_accounts
   WHERE user_id='fefefefe-fefe-4efe-8efe-fefefefefefe';
  IF v_account_margin<>0 OR v_account_realized<>25000 OR v_cash<>100044000
     OR EXISTS(SELECT 1 FROM public.paper_futures_positions
       WHERE user_id='fefefefe-fefe-4efe-8efe-fefefefefefe'
         AND instrument_key='NSE_FO|FUT_CLOSE_TEST') THEN
    RAISE EXCEPTION 'Futures short close failed to reconcile cash, margin and realized P&L';
  END IF;

  -- Excessive opening margin must reject atomically without an order or cash change.
  v_rejected:=false;
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  BEGIN
    PERFORM public.execute_paper_futures_market_order(
      'fefefefe-fefe-4efe-8efe-fefefefefefe',repeat('7',64),
      '11111111-1111-4111-8111-111111111111',repeat('8',64),
      'NSE_FO|FUT_MARGIN_FAIL','FUT_MARGIN_FAIL','NSE','NSE_FO',current_date+5,
      25,5,'BUY','DELIVERY',25,10000,200000000,1000,v_now,v_now
    );
  EXCEPTION WHEN SQLSTATE '23514' THEN
    v_rejected:=true;
  END;
  IF NOT v_rejected
     OR EXISTS(SELECT 1 FROM public.paper_futures_orders WHERE order_id=repeat('7',64))
     OR EXISTS(SELECT 1 FROM public.paper_futures_positions WHERE instrument_key='NSE_FO|FUT_MARGIN_FAIL')
     OR (SELECT cash_paise FROM public.paper_accounts WHERE user_id='fefefefe-fefe-4efe-8efe-fefefefefefe')<>100044000 THEN
    RAISE EXCEPTION 'Insufficient futures margin rejection mutated account state';
  END IF;

  -- Stale provider quote and expired contract are rejected before any write.
  v_rejected:=false;
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  BEGIN
    PERFORM public.execute_paper_futures_market_order(
      'fefefefe-fefe-4efe-8efe-fefefefefefe',repeat('9',64),
      '22222222-2222-4222-8222-222222222222',repeat('a',64),
      'NSE_FO|FUT_STALE','FUT_STALE','NSE','NSE_FO',current_date+5,
      25,5,'BUY','DELIVERY',25,10000,100000,1000,v_now-20000,v_now
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected:=true;
  END;
  IF NOT v_rejected OR EXISTS(SELECT 1 FROM public.paper_futures_orders WHERE order_id=repeat('9',64)) THEN
    RAISE EXCEPTION 'Stale futures quote was accepted or persisted';
  END IF;

  v_rejected:=false;
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  BEGIN
    PERFORM public.execute_paper_futures_market_order(
      'fefefefe-fefe-4efe-8efe-fefefefefefe',repeat('b',64),
      '33333333-3333-4333-8333-333333333333',repeat('c',64),
      'NSE_FO|FUT_EXPIRED','FUT_EXPIRED','NSE','NSE_FO',current_date-1,
      25,5,'BUY','DELIVERY',25,10000,100000,1000,v_now,v_now
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected:=true;
  END;
  IF NOT v_rejected OR EXISTS(SELECT 1 FROM public.paper_futures_orders WHERE order_id=repeat('b',64)) THEN
    RAISE EXCEPTION 'Expired futures contract was accepted or persisted';
  END IF;
END
$futures_accounting$;
ROLLBACK;
