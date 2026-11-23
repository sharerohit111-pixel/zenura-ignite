-- Regression: long-option premium orders must coexist with reserved futures margin.
-- Runs only in disposable CI PostgreSQL; all fixture rows are rolled back.
BEGIN;
INSERT INTO auth.users(id) VALUES ('abababab-abab-4bab-8bab-abababababab')
ON CONFLICT (id) DO NOTHING;
SELECT public.initialize_paper_trading_account('abababab-abab-4bab-8bab-abababababab');

DO $option_futures_margin$
DECLARE
  v_now bigint;
  v_result jsonb;
  v_cash bigint;
  v_reserved_margin bigint;
  v_option_quantity integer;
  v_option_basis bigint;
BEGIN
  INSERT INTO public.paper_futures_positions(
    user_id,instrument_key,trading_symbol,exchange,segment,expiry,product,
    lot_size,tick_size_paise,net_quantity,average_price_paise,
    reserved_margin_paise,realized_pnl_paise,updated_at
  ) VALUES (
    'abababab-abab-4bab-8bab-abababababab',
    'NSE_FO|FUT_MARGIN_COMPAT','FUT_MARGIN_COMPAT','NSE','NSE_FO',
    current_date+5,'DELIVERY',25,5,25,10000,200000,0,now()
  );
  UPDATE public.paper_accounts
     SET reserved_margin_paise=200000
   WHERE user_id='abababab-abab-4bab-8bab-abababababab';

  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.execute_paper_long_option_order(
    'abababab-abab-4bab-8bab-abababababab',
    repeat('e',32)||repeat('f',32),'abababab-0000-4000-8000-000000000001',repeat('b',64),
    'NSE_FO|NIFTY_MARGIN_COMPAT_CE','NIFTY_MARGIN_COMPAT_CE',
    'NSE','NSE_FO','CE',current_date+5,25000,65,5,1,'BUY',1250,v_now,v_now
  );

  SELECT cash_paise,reserved_margin_paise
    INTO v_cash,v_reserved_margin
    FROM public.paper_accounts
   WHERE user_id='abababab-abab-4bab-8bab-abababababab';
  SELECT net_quantity,cost_basis_paise
    INTO v_option_quantity,v_option_basis
    FROM public.paper_derivative_positions
   WHERE user_id='abababab-abab-4bab-8bab-abababababab'
     AND instrument_key='NSE_FO|NIFTY_MARGIN_COMPAT_CE';

  IF (v_result->>'idempotent_replay')::boolean IS NOT FALSE
     OR v_cash<>99916354
     OR v_reserved_margin<>200000
     OR v_option_quantity<>65
     OR v_option_basis<>83646 THEN
    RAISE EXCEPTION 'Option BUY did not coexist with reserved futures margin: result %, cash %, margin %, option qty %, basis %',
      v_result,v_cash,v_reserved_margin,v_option_quantity,v_option_basis;
  END IF;
END
$option_futures_margin$;
ROLLBACK;
