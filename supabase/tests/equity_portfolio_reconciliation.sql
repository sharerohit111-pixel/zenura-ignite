-- Disposable end-to-end Equity cash, reservation, fill and position reconciliation.
-- Uses an isolated fresh user and rolls back every fixture row.
BEGIN;
INSERT INTO auth.users(id)
VALUES ('45454545-4545-4545-8545-454545454545')
ON CONFLICT (id) DO NOTHING;
SELECT public.initialize_paper_trading_account('45454545-4545-4545-8545-454545454545');

DO $equity_portfolio_reconciliation$
DECLARE
  v_user uuid := '45454545-4545-4545-8545-454545454545';
  v_now_ms bigint := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result jsonb;
  v_cash bigint;
  v_reserved_cash bigint;
  v_reserved_margin bigint;
  v_realized bigint;
  v_expected_cash bigint;
  v_expected_reserved bigint;
  v_expected_realized bigint;
BEGIN
  -- DELIVERY: BUY then partial SELL; both must produce one immutable fill and trade event.
  PERFORM public.execute_paper_market_order(
    v_user,repeat('a1',32),'aaaaaaaa-4545-4545-8545-454545454545',repeat('b',64),
    'NSE_EQ|RECON_DELIVERY','RECONDEL','NSE','BUY','DELIVERY',10,10000,v_now_ms,0
  );
  PERFORM public.execute_paper_market_order(
    v_user,repeat('b2',32),'bbbbbbbb-4545-4545-8545-454545454545',repeat('c',64),
    'NSE_EQ|RECON_DELIVERY','RECONDEL','NSE','SELL','DELIVERY',4,12000,v_now_ms,0
  );

  -- INTRADAY position remains isolated from DELIVERY for the same accounting engine.
  PERFORM public.execute_paper_market_order(
    v_user,repeat('c3',32),'cccccccc-4545-4545-8545-454545454545',repeat('d',64),
    'NSE_EQ|RECON_INTRADAY','RECONINTRA','NSE','BUY','INTRADAY',2,15000,v_now_ms,0
  );

  -- A pending Delivery LIMIT BUY must be represented as blocked cash, then fully released.
  v_result := public.submit_paper_limit_order(
    v_user,repeat('d',64),'dddddddd-4545-4545-8545-454545454545',repeat('e',64),
    'NSE_EQ|RECON_LIMIT','RECONLIMIT','NSE','BUY',3,10000
  );
  IF v_result->>'status' <> 'PENDING' THEN
    RAISE EXCEPTION 'Reconciliation fixture LIMIT order was not accepted';
  END IF;
  v_result := public.cancel_paper_limit_order(v_user,repeat('d',64));
  IF v_result->>'status' <> 'CANCELLED' THEN
    RAISE EXCEPTION 'Reconciliation fixture LIMIT reservation was not released';
  END IF;

  SELECT cash_paise,reserved_cash_paise,reserved_margin_paise,realized_pnl_paise
    INTO v_cash,v_reserved_cash,v_reserved_margin,v_realized
    FROM public.paper_accounts WHERE user_id=v_user;

  SELECT 100000000 + coalesce(sum(cash_delta_paise),0),
         coalesce(sum(reserved_cash_delta_paise),0)
    INTO v_expected_cash,v_expected_reserved
    FROM public.paper_equity_cash_ledger WHERE user_id=v_user;

  SELECT coalesce(sum(realized_pnl_paise),0)
    INTO v_expected_realized
    FROM public.paper_equity_fills WHERE user_id=v_user;

  IF v_cash<>v_expected_cash THEN
    RAISE EXCEPTION 'Cash reconciliation mismatch: account %, ledger-derived %',v_cash,v_expected_cash;
  END IF;
  IF v_reserved_cash<>v_expected_reserved THEN
    RAISE EXCEPTION 'Blocked-cash reconciliation mismatch: account %, ledger-derived %',
      v_reserved_cash,v_expected_reserved;
  END IF;
  IF v_reserved_margin<>0 THEN
    RAISE EXCEPTION 'Equity-only fixture unexpectedly changed shared Futures margin: %',v_reserved_margin;
  END IF;
  IF v_realized<>v_expected_realized THEN
    RAISE EXCEPTION 'Realized P&L reconciliation mismatch: account %, fill-derived %',
      v_realized,v_expected_realized;
  END IF;

  -- Every execution has exactly one matching trade event with identical ownership,
  -- order, fill identity, side-derived event type and cash delta.
  IF EXISTS (
    SELECT 1 FROM public.paper_equity_fills f
    LEFT JOIN public.paper_equity_cash_ledger l
      ON l.user_id=f.user_id AND l.order_id=f.order_id AND l.fill_id=f.fill_id
     AND l.event_type=CASE WHEN f.side='BUY' THEN 'TRADE_DEBIT' ELSE 'TRADE_CREDIT' END
     AND l.cash_delta_paise=f.cash_delta_paise
    WHERE f.user_id=v_user AND l.ledger_id IS NULL
  ) THEN
    RAISE EXCEPTION 'A fill is missing its exact matching trade cash-ledger event';
  END IF;
  IF (SELECT count(*) FROM public.paper_equity_cash_ledger
      WHERE user_id=v_user AND event_type IN ('TRADE_DEBIT','TRADE_CREDIT'))
     <> (SELECT count(*) FROM public.paper_equity_fills WHERE user_id=v_user) THEN
    RAISE EXCEPTION 'Trade ledger event count does not equal immutable fill count';
  END IF;

  -- Position cost basis must reconcile to fee-inclusive BUY debits less the
  -- cost basis released by SELL fills. For each SELL, net proceeds minus the
  -- immutable realized P&L is the allocated cost basis.
  IF EXISTS (
    WITH fill_basis AS (
      SELECT instrument_key,product,
        sum(CASE WHEN side='BUY' THEN -cash_delta_paise ELSE 0 END)
        - sum(CASE WHEN side='SELL' THEN cash_delta_paise-realized_pnl_paise ELSE 0 END)
          AS expected_cost_basis_paise
      FROM public.paper_equity_fills WHERE user_id=v_user
      GROUP BY instrument_key,product
    ), position_basis AS (
      SELECT instrument_key,product,cost_basis_paise
      FROM public.paper_equity_positions WHERE user_id=v_user
    )
    SELECT 1 FROM fill_basis f
    FULL JOIN position_basis p USING (instrument_key,product)
    WHERE coalesce(f.expected_cost_basis_paise,0)<>coalesce(p.cost_basis_paise,0)
  ) THEN
    RAISE EXCEPTION 'Equity position cost basis does not reconcile to fee-inclusive fill history';
  END IF;

  -- Current position quantity must equal signed immutable fill quantity, per product
  -- and instrument; this also detects accidental DELIVERY/INTRADAY cross-contamination.
  IF EXISTS (
    WITH fill_totals AS (
      SELECT instrument_key,product,
             sum(CASE WHEN side='BUY' THEN quantity ELSE -quantity END)::integer AS quantity
      FROM public.paper_equity_fills WHERE user_id=v_user
      GROUP BY instrument_key,product
    ), position_totals AS (
      SELECT instrument_key,product,quantity
      FROM public.paper_equity_positions WHERE user_id=v_user
    )
    SELECT 1
    FROM fill_totals f
    FULL JOIN position_totals p USING (instrument_key,product)
    WHERE coalesce(f.quantity,0)<>coalesce(p.quantity,0)
  ) THEN
    RAISE EXCEPTION 'Equity position quantity does not reconcile to signed fill history';
  END IF;
END
$equity_portfolio_reconciliation$;
ROLLBACK;
