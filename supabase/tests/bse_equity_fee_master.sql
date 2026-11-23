BEGIN;
SET LOCAL ROLE service_role;
SELECT public.import_bse_equity_fee_master(
  (now() at time zone 'Asia/Kolkata')::date-1,
  repeat('b',64),
  'https://www.bseindia.com/downloads/Help/file/scrip.zip',
  jsonb_build_array(
    jsonb_build_object('scrip_code','599999','instrument_code','OLDONLY','group_name','A','scrip_name','OLD SNAPSHOT ONLY','isin','INE888A01010','exclusive_flag','N','status','A','instrument_type','E')
  )
);
SELECT public.import_bse_equity_fee_master(
  (now() at time zone 'Asia/Kolkata')::date,
  repeat('a',64),
  'https://www.bseindia.com/downloads/Help/file/scrip.zip',
  jsonb_build_array(
    jsonb_build_object('scrip_code','500325','instrument_code','RELIANCE','group_name','A','scrip_name','RELIANCE INDUSTRIES LIMITED','isin','INE002A01018','exclusive_flag','N','status','A','instrument_type','E'),
    jsonb_build_object('scrip_code','500180','instrument_code','HDFCBANK','group_name','E','scrip_name','HDFC BANK LIMITED','isin','INE040A01034','exclusive_flag','Y','status','A','instrument_type','E'),
    jsonb_build_object('scrip_code','500570','instrument_code','TATAMOTORS','group_name','M','scrip_name','TATA MOTORS LIMITED','isin','INE155A01022','exclusive_flag','N','status','A','instrument_type','E'),
    jsonb_build_object('scrip_code','500112','instrument_code','SBIN','group_name','X','scrip_name','STATE BANK OF INDIA','isin','INE062A01020','exclusive_flag','N','status','A','instrument_type','E'),
    jsonb_build_object('scrip_code','500777','instrument_code','SPECIALP','group_name','P','scrip_name','SPECIAL GROUP P LIMITED','isin','INE777A01010','exclusive_flag','N','status','A','instrument_type','E')
  )
);
RESET ROLE;
INSERT INTO auth.users(id) VALUES ('66666666-6666-4666-8666-666666666666')
ON CONFLICT (id) DO NOTHING;
SELECT public.initialize_paper_trading_account('66666666-6666-4666-8666-666666666666');
INSERT INTO public.paper_exchange_sessions(
  exchange,session_date,is_trading_day,open_minute,close_minute,session_kind,source_reference,verified_at,source_sha256
) VALUES (
  'BSE',(now() at time zone 'Asia/Kolkata')::date,true,0,1440,'SPECIAL',
  'CI-only BSE Intraday LIMIT session fixture',now(),repeat('c',64)
);

DO $bse_fee_master$
DECLARE
  v_a jsonb;
  v_e jsonb;
  v_m jsonb;
  v_x jsonb;
  v_rejected boolean;
  v_result jsonb;
  v_cash bigint;
  v_reserved bigint;
  v_realized bigint;
  v_date date:=(now() at time zone 'Asia/Kolkata')::date;
BEGIN
  v_a:=public._paper_bse_cash_equity_charges('BSE_EQ|INE002A01018',1000000000,'DELIVERY','BUY');
  IF (v_a->>'exchange_transaction_paise')::bigint<>37500
     OR (v_a->>'exchange_rate_rupees_per_crore')::integer<>375
     OR (v_a->>'exchange_rate_paise_per_crore')::integer<>37500
     OR v_a->>'simulation_billing_basis'<>'indicative_per_fill_allocation'
     OR (v_a->>'brokerage_paise')::bigint<>2000
     OR (v_a->>'sebi_paise')::bigint<>1000
     OR (v_a->>'stamp_duty_paise')::bigint<>150000
     OR (v_a->>'stt_paise')::bigint<>1000000
     OR (v_a->>'gst_paise')::bigint<>7110
     OR (v_a->>'total_charges_paise')::bigint<>1197610
     OR v_a->>'scrip_group'<>'A'
     OR v_a->>'exclusive_flag'<>'N'
     OR (v_a->>'master_source_date')::date<>v_date THEN
    RAISE EXCEPTION 'BSE Group A non-exclusive Delivery BUY fee vector mismatch: %',v_a;
  END IF;
  v_e:=public._paper_bse_cash_equity_charges('BSE_EQ|INE040A01034',1000000000,'INTRADAY','SELL');
  IF (v_e->>'exchange_transaction_paise')::bigint<>27500
     OR (v_e->>'stt_paise')::bigint<>250000
     OR (v_e->>'total_charges_paise')::bigint<>285810
     OR (v_e->>'exchange_rate_paise_per_crore')::integer<>27500
     OR (v_e->>'net_credit_paise')::bigint<>(1000000000-(v_e->>'total_charges_paise')::bigint)
     OR v_e->>'exclusive_flag'<>'Y' THEN
    RAISE EXCEPTION 'BSE Group E exclusive Intraday SELL fee vector mismatch: %',v_e;
  END IF;
  v_m:=public._paper_bse_cash_equity_charges('BSE_EQ|INE155A01022',1000000000,'DELIVERY','BUY');
  IF (v_m->>'exchange_rate_paise_per_crore')::integer<>27500 THEN
    RAISE EXCEPTION 'BSE Group M fee rate mismatch: %',v_m;
  END IF;
  v_x:=public._paper_bse_cash_equity_charges('BSE_EQ|INE062A01020',1000000000,'DELIVERY','BUY');
  IF (v_x->>'exchange_rate_paise_per_crore')::integer<>1000000 THEN
    RAISE EXCEPTION 'BSE Group X fee rate mismatch: %',v_x;
  END IF;
  v_rejected:=false;
  BEGIN
    PERFORM public._paper_bse_cash_equity_charges('BSE_EQ|INE777A01010',1000000000,'DELIVERY','BUY');
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'BSE Group P was not blocked for settlement-offset ambiguity'; END IF;
  v_rejected:=false;
  BEGIN
    PERFORM public._paper_bse_cash_equity_charges('BSE_EQ|INE888A01010',1000000000,'DELIVERY','BUY');
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'ISIN missing from latest BSE snapshot fell back to stale classification'; END IF;
  v_rejected:=false;
  BEGIN
    PERFORM public._paper_bse_cash_equity_charges('BSE_EQ|INE999A01010',1000000000,'DELIVERY','BUY');
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Unknown BSE ISIN was not blocked'; END IF;
  -- Exercise the actual BSE MARKET settlement RPC using Group A non-exclusive fees.
  v_result:=public.execute_paper_market_order(
    '66666666-6666-4666-8666-666666666666',repeat('d',64),
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',repeat('e',64),
    'BSE_EQ|INE002A01018','RELIANCE','BSE','BUY','INTRADAY',100,100000,
    floor(extract(epoch from clock_timestamp())*1000)::bigint,0
  );
  SELECT cash_paise INTO v_cash FROM public.paper_accounts
   WHERE user_id='66666666-6666-4666-8666-666666666666';
  IF (v_result->>'charges_paise')::bigint<>3113
     OR (v_result->>'cash_delta_paise')::bigint<>-10003113
     OR v_cash<>89996887
     OR v_result->'charges_breakdown'->>'scrip_group'<>'A'
     OR (v_result->'charges_breakdown'->>'exchange_rate_paise_per_crore')::integer<>37500 THEN
    RAISE EXCEPTION 'BSE MARKET BUY did not use the imported Group A fee master: %',v_result;
  END IF;
  v_result:=public.execute_paper_market_order(
    '66666666-6666-4666-8666-666666666666',repeat('f',64),
    'ffffffff-ffff-4fff-8fff-ffffffffffff',repeat('1',64),
    'BSE_EQ|INE002A01018','RELIANCE','BSE','SELL','INTRADAY',100,120000,
    floor(extract(epoch from clock_timestamp())*1000)::bigint,0
  );
  SELECT cash_paise,realized_pnl_paise INTO v_cash,v_realized FROM public.paper_accounts
   WHERE user_id='66666666-6666-4666-8666-666666666666';
  IF (v_result->>'charges_paise')::bigint<>5903
     OR (v_result->>'cash_delta_paise')::bigint<>11994097
     OR v_cash<>101990984 OR v_realized<>1990984 THEN
    RAISE EXCEPTION 'BSE MARKET SELL net proceeds or realized P&L mismatch: %, cash %, realized %',v_result,v_cash,v_realized;
  END IF;

  -- Exercise BSE Delivery LIMIT reservation and fill using the same daily scrip master.
  v_result:=public.submit_paper_limit_order(
    '66666666-6666-4666-8666-666666666666',repeat('2',64),
    '22222222-2222-4222-8222-222222222222',repeat('3',64),
    'BSE_EQ|INE002A01018','RELIANCE','BSE','BUY',10,100000
  );
  SELECT reserved_cash_paise INTO v_reserved FROM public.paper_accounts
   WHERE user_id='66666666-6666-4666-8666-666666666666';
  IF v_reserved<>1003556 THEN
    RAISE EXCEPTION 'BSE Delivery LIMIT did not reserve exchange-specific charges: %',v_reserved;
  END IF;
  v_result:=public.execute_paper_limit_fill(
    repeat('2',64),99000,floor(extract(epoch from clock_timestamp())*1000)::bigint,0,
    floor(extract(epoch from clock_timestamp())*1000)::bigint
  );
  SELECT reserved_cash_paise,cash_paise INTO v_reserved,v_cash FROM public.paper_accounts
   WHERE user_id='66666666-6666-4666-8666-666666666666';
  IF v_result->>'status'<>'FILLED' OR v_reserved<>0 OR v_cash<>100997440
     OR (v_result->>'charges_paise')::bigint<>3544
     OR v_result->'charges_breakdown'->>'scrip_group'<>'A' THEN
    RAISE EXCEPTION 'BSE Delivery LIMIT fill did not settle with the imported fee master: %',v_result;
  END IF;

  -- BSE LIMIT SELL credits net proceeds and realizes P&L after group fees and statutory charges.
  PERFORM public.submit_paper_limit_order(
    '66666666-6666-4666-8666-666666666666',repeat('4',64),
    '44444444-4444-4444-8444-444444444444',repeat('5',64),
    'BSE_EQ|INE002A01018','RELIANCE','BSE','SELL',5,120000
  );
  v_result:=public.execute_paper_limit_fill(
    repeat('4',64),120000,floor(extract(epoch from clock_timestamp())*1000)::bigint,0,
    floor(extract(epoch from clock_timestamp())*1000)::bigint
  );
  SELECT cash_paise,realized_pnl_paise INTO v_cash,v_realized FROM public.paper_accounts
   WHERE user_id='66666666-6666-4666-8666-666666666666';
  IF (v_result->>'charges_paise')::bigint<>5348
     OR (v_result->>'cash_delta_paise')::bigint<>594652
     OR (v_result->>'realized_pnl_paise')::bigint<>97880
     OR v_cash<>101592092 OR v_realized<>2088864 THEN
    RAISE EXCEPTION 'BSE Delivery LIMIT SELL net settlement mismatch: %, cash %, realized %',v_result,v_cash,v_realized;
  END IF;

  -- BSE Intraday LIMIT uses its own verified session and the same group-specific fee resolver.
  v_result:=public.submit_paper_intraday_limit_order(
    '66666666-6666-4666-8666-666666666666',repeat('6',64),
    '66666666-6666-4666-8666-666666666667',repeat('7',64),
    'BSE_EQ|INE002A01018','RELIANCE','BSE','BUY',2,100000
  );
  SELECT reserved_cash_paise INTO v_reserved FROM public.paper_accounts
   WHERE user_id='66666666-6666-4666-8666-666666666666';
  IF v_reserved<>200251 THEN
    RAISE EXCEPTION 'BSE Intraday LIMIT did not reserve group-specific charges: %',v_reserved;
  END IF;
  v_result:=public.execute_paper_intraday_limit_fill(
    repeat('6',64),99000,floor(extract(epoch from clock_timestamp())*1000)::bigint,0,
    floor(extract(epoch from clock_timestamp())*1000)::bigint
  );
  SELECT reserved_cash_paise,cash_paise INTO v_reserved,v_cash FROM public.paper_accounts
   WHERE user_id='66666666-6666-4666-8666-666666666666';
  IF v_result->>'status'<>'FILLED' OR v_reserved<>0 OR v_cash<>101393844
     OR (v_result->>'charges_paise')::bigint<>248
     OR (v_result->>'cash_delta_paise')::bigint<>-198248
     OR v_result->'charges_breakdown'->>'scrip_group'<>'A' THEN
    RAISE EXCEPTION 'BSE Intraday LIMIT fill did not settle from the verified BSE fee master: %',v_result;
  END IF;

  v_rejected:=false;
  BEGIN
    PERFORM public.import_bse_equity_fee_master(
      v_date-8,repeat('b',64),'https://www.bseindia.com/',
      jsonb_build_array(jsonb_build_object('scrip_code','1','instrument_code','OLD','group_name','A','scrip_name','OLD','isin','INE999A01011','exclusive_flag','N','status','A','instrument_type','E'))
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Stale BSE master import was accepted'; END IF;
  v_rejected:=false;
  BEGIN
    PERFORM public.import_bse_equity_fee_master(
      v_date,repeat('c',64),'https://www.bseindia.com/',
      jsonb_build_array(jsonb_build_object('scrip_code','1','instrument_code','BAD','group_name','A','scrip_name','BAD','isin','INE999A01012','exclusive_flag',null,'status','A','instrument_type','E'))
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Null BSE exclusive flag was accepted'; END IF;
END
$bse_fee_master$;
ROLLBACK;
