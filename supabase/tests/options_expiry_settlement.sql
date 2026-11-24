-- Disposable PostgreSQL regression for atomic, idempotent NSE index option expiry.
BEGIN;

INSERT INTO auth.users(id) VALUES ('d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2')
ON CONFLICT(id) DO NOTHING;
SELECT public.initialize_paper_trading_account('d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2');

INSERT INTO public.paper_derivative_positions(
  user_id,instrument_key,trading_symbol,segment,exchange,instrument_type,
  expiry,lot_size,net_quantity,average_price_paise,cost_basis_paise,
  reserved_quantity,updated_at
) VALUES (
  'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2','NSE_FO|EXPIRY_CE_TEST',
  'EXPIRY CE TEST','NSE_FO','NSE','CE','2026-11-20',65,65,7692,500000,0,now()
);

DO $expiry_settlement$
DECLARE
  v_now bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_verified bigint;
  v_settlement_ms bigint:=floor(extract(epoch from ('2026-11-20 16:00:00'::timestamp at time zone 'Asia/Kolkata'))*1000)::bigint;
  v_source text:='NSE official settlement bhavcopy test fixture';
  v_sha text;
  v_result jsonb;
  v_cash bigint;
  v_realized bigint;
  v_count integer;
  v_rejected boolean;
BEGIN
  v_verified:=v_now;
  v_sha:=encode(extensions.digest(convert_to(v_source,'UTF8'),'sha256'),'hex');
  v_result:=public.settle_paper_long_index_option_expiry(
    'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2',repeat('c',64),
    'NSE_FO|EXPIRY_CE_TEST','EXPIRY CE TEST','CE','INDEX','CASH_SETTLED',
    '2026-11-20',250000,260000,
    'https://www.nseindia.com/reports/settlement-price',v_source,v_sha,
    v_settlement_ms,v_verified,v_now
  );
  IF v_result->>'idempotent_replay'<>'false'
     OR (v_result->>'gross_payout_paise')::bigint<>650000
     OR (v_result->>'exercise_stt_paise')::bigint<>1000
     OR (v_result->>'net_payout_paise')::bigint<>649000
     OR (v_result->>'realized_pnl_paise')::bigint<>149000 THEN
    RAISE EXCEPTION 'Unexpected cash-settled index expiry result: %',v_result;
  END IF;

  SELECT cash_paise,realized_pnl_paise INTO v_cash,v_realized
    FROM public.paper_accounts
   WHERE user_id='d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2';
  SELECT count(*) INTO v_count FROM public.paper_option_expiry_settlements
   WHERE settlement_id=repeat('c',64);
  IF v_cash<>100649000 OR v_realized<>149000 OR v_count<>1
     OR EXISTS(SELECT 1 FROM public.paper_derivative_positions
       WHERE user_id='d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2'
         AND instrument_key='NSE_FO|EXPIRY_CE_TEST') THEN
    RAISE EXCEPTION 'Expiry ledger, account cash/P&L or position close did not reconcile.';
  END IF;

  -- Exact replay must not post the payout twice.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.settle_paper_long_index_option_expiry(
    'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2',repeat('c',64),
    'NSE_FO|EXPIRY_CE_TEST','EXPIRY CE TEST','CE','INDEX','CASH_SETTLED',
    '2026-11-20',250000,260000,
    'https://www.nseindia.com/reports/settlement-price',v_source,v_sha,
    v_settlement_ms,v_verified,v_now
  );
  SELECT cash_paise INTO v_cash FROM public.paper_accounts
   WHERE user_id='d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2';
  IF v_result->>'idempotent_replay'<>'true' OR v_cash<>100649000 THEN
    RAISE EXCEPTION 'Expiry settlement replay was not idempotent.';
  END IF;

  -- Physical settlement and a mismatched source digest must fail closed.
  v_rejected:=false;
  BEGIN
    PERFORM public.settle_paper_long_index_option_expiry(
      'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2',repeat('d',64),
      'NSE_FO|PHYSICAL_TEST','PHYSICAL TEST','CE','STOCK','PHYSICAL',
      '2026-11-20',250000,260000,
      'https://www.nseindia.com/reports/settlement-price',v_source,v_sha,
      v_settlement_ms,v_now,v_now
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Physical-settled option was accepted.'; END IF;

  v_rejected:=false;
  BEGIN
    PERFORM public.settle_paper_long_index_option_expiry(
      'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2',repeat('e',64),
      'NSE_FO|BAD_HASH_TEST','BAD HASH TEST','CE','INDEX','CASH_SETTLED',
      '2026-11-20',250000,260000,
      'https://www.nseindia.com/reports/settlement-price',v_source,repeat('0',64),
      v_settlement_ms,v_now,v_now
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Mismatched official source digest was accepted.'; END IF;

  v_rejected:=false;
  BEGIN
    UPDATE public.paper_option_expiry_settlements
       SET net_payout_paise=0 WHERE settlement_id=repeat('c',64);
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Immutable expiry receipt allowed an update.'; END IF;
END
$expiry_settlement$;

ROLLBACK;
