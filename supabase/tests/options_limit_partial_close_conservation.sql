-- Chat 6 regression: repeated partial Options LIMIT closes must conserve
-- fee-inclusive entry basis, cash, reservations and realized P&L.
-- Disposable PostgreSQL only; the whole fixture rolls back.
BEGIN;

INSERT INTO auth.users(id)
VALUES ('6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c')
ON CONFLICT(id) DO NOTHING;
SELECT public.initialize_paper_trading_account('6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c');

INSERT INTO public.paper_exchange_sessions(
  exchange,session_date,is_trading_day,open_minute,close_minute,
  session_kind,source_reference,verified_at,source_sha256
) VALUES (
  'NSE',(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date,
  true,0,1440,'SPECIAL',
  'https://www.nseindia.com/market-data/holidays?chat6-partial-close-conservation',
  clock_timestamp(),repeat('f',64)
)
ON CONFLICT(exchange,session_date) DO UPDATE SET
  is_trading_day=EXCLUDED.is_trading_day,
  open_minute=EXCLUDED.open_minute,
  close_minute=EXCLUDED.close_minute,
  session_kind=EXCLUDED.session_kind,
  source_reference=EXCLUDED.source_reference,
  verified_at=EXCLUDED.verified_at,
  source_sha256=EXCLUDED.source_sha256;

DO $options_partial_close_conservation$
DECLARE
  v_now bigint;
  v_result jsonb;
  v_starting_cash bigint;
  v_cash bigint;
  v_reserved_cash bigint;
  v_reserved_margin bigint;
  v_realized bigint;
  v_entry_basis bigint;
  v_buy_gross bigint;
  v_buy_charges bigint;
  v_sell_gross bigint;
  v_sell_charges bigint;
  v_expected_cash bigint;
  v_fill_count integer;
  v_filled integer;
  v_status text;
  v_fill_realized bigint;
  v_fill_charges bigint;
  v_released_basis bigint;
BEGIN
  SELECT starting_cash_paise INTO v_starting_cash
    FROM public.paper_accounts
   WHERE user_id='6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c';

  -- Seed three long CE lots using the unchanged MARKET accounting RPC.
  v_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  PERFORM public.execute_paper_long_option_order(
    '6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c',
    repeat('1',64),'6c6c6c6c-0000-4000-8000-000000000001',repeat('a',64),
    'NSE_FO|CHAT6_PARTIAL_CLOSE','CHAT6_PARTIAL_CLOSE',
    'NSE','NSE_FO','CE',(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date+5,
    25000,65,5,3,'BUY',1250,v_now,v_now
  );

  SELECT cost_basis_paise INTO v_entry_basis
    FROM public.paper_derivative_positions
   WHERE user_id='6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c'
     AND instrument_key='NSE_FO|CHAT6_PARTIAL_CLOSE';

  -- Reserve all three lots for one LIMIT SELL, then close one lot per fill.
  v_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  PERFORM public.submit_paper_option_limit_order(
    '6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c',repeat('2',64),
    '6c6c6c6c-0000-4000-8000-000000000002',repeat('b',64),
    'NSE_FO|CHAT6_PARTIAL_CLOSE','CHAT6_PARTIAL_CLOSE',
    'NSE','NSE_FO','CE',(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date+5,
    25000,65,5,'SELL',195,1500,v_now,clock_timestamp()+interval '10 minutes'
  );

  FOR i IN 1..3 LOOP
    v_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
    v_result:=public.execute_paper_option_limit_fill(
      repeat('2',64),'CHAT6-PARTIAL-CLOSE-'||i::text,i,65,1500,
      1500,1505,65,100,v_now,v_now
    );
    IF v_result->>'status' IS DISTINCT FROM
       CASE WHEN i=3 THEN 'FILLED' ELSE 'PARTIALLY_FILLED' END THEN
      RAISE EXCEPTION 'Unexpected status on repeated partial close %: %',i,v_result;
    END IF;
  END LOOP;

  SELECT status,filled_quantity,cumulative_gross_paise,cumulative_charges_paise
    INTO v_status,v_filled,v_sell_gross,v_sell_charges
    FROM public.paper_option_limit_orders WHERE order_id=repeat('2',64);

  SELECT gross_paise,charges_paise
    INTO v_buy_gross,v_buy_charges
    FROM public.paper_derivative_orders
   WHERE order_id=repeat('1',64) AND status='FILLED';

  SELECT count(*),coalesce(sum(realized_pnl_paise),0),
         coalesce(sum(incremental_charges_paise),0),
         coalesce(sum(gross_paise-incremental_charges_paise-realized_pnl_paise),0)
    INTO v_fill_count,v_fill_realized,v_fill_charges,v_released_basis
    FROM public.paper_option_limit_fills
   WHERE order_id=repeat('2',64);

  SELECT cash_paise,reserved_cash_paise,reserved_margin_paise,realized_pnl_paise
    INTO v_cash,v_reserved_cash,v_reserved_margin,v_realized
    FROM public.paper_accounts
   WHERE user_id='6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c';

  v_expected_cash:=v_starting_cash-v_buy_gross-v_buy_charges
                   +v_sell_gross-v_sell_charges;

  IF v_status<>'FILLED' OR v_filled<>195 OR v_fill_count<>3
     OR v_fill_charges<>v_sell_charges
     OR v_released_basis<>v_entry_basis
     OR v_realized<>v_fill_realized
     OR v_cash<>v_expected_cash
     OR v_reserved_cash<>0 OR v_reserved_margin<>0
     OR EXISTS(
       SELECT 1 FROM public.paper_derivative_positions
        WHERE user_id='6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c'
          AND instrument_key='NSE_FO|CHAT6_PARTIAL_CLOSE'
     ) THEN
    RAISE EXCEPTION
      'Repeated partial close conservation failed: status %, filled %, fills %, entry basis %, released basis %, fill realized %, account realized %, cash %, expected cash %, reserved cash %, reserved margin %',
      v_status,v_filled,v_fill_count,v_entry_basis,v_released_basis,
      v_fill_realized,v_realized,v_cash,v_expected_cash,v_reserved_cash,v_reserved_margin;
  END IF;
END
$options_partial_close_conservation$;

ROLLBACK;
