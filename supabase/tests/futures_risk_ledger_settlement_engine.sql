-- Disposable PostgreSQL integration test for persistent Futures risk/accounting.
begin;
insert into auth.users(id) values ('abababab-abab-4bab-8bab-abababababab')
on conflict(id) do nothing;
select public.initialize_paper_trading_account('abababab-abab-4bab-8bab-abababababab');

insert into public.paper_exchange_sessions(
  exchange,session_date,is_trading_day,open_minute,close_minute,
  session_kind,source_reference,verified_at,source_sha256
) values
  ('NSE',current_date-1,true,0,1440,'SPECIAL',
   'https://www.nseindia.com/market-data/holidays',clock_timestamp(),repeat('a',64)),
  ('NSE',current_date,true,0,1440,'SPECIAL',
   'https://www.nseindia.com/market-data/holidays',clock_timestamp(),repeat('b',64))
on conflict(exchange,session_date) do update set
  is_trading_day=true,open_minute=0,close_minute=1440,session_kind='SPECIAL',
  source_reference=excluded.source_reference,verified_at=clock_timestamp(),
  source_sha256=excluded.source_sha256;

do $futures_risk$
declare
  v_now bigint;
  v_result jsonb;
  v_cash bigint;
  v_margin bigint;
  v_realized bigint;
  v_avg bigint;
  v_qty integer;
  v_count integer;
  v_rejected boolean;
  v_status text;
  v_deficit bigint;
begin
  -- Open long position with a pre-existing 100000-paise initial reservation.
  update public.paper_accounts set cash_paise=90000,reserved_margin_paise=100000
   where user_id='abababab-abab-4bab-8bab-abababababab';
  insert into public.paper_futures_positions(
    user_id,instrument_key,trading_symbol,exchange,segment,expiry,product,
    lot_size,tick_size_paise,net_quantity,average_price_paise,
    reserved_margin_paise,realized_pnl_paise
  ) values (
    'abababab-abab-4bab-8bab-abababababab','NSE_FO|RISK_TEST','RISK_TEST',
    'NSE','NSE_FO',current_date+10,'DELIVERY',25,5,25,10000,100000,0
  );
  select margin_deficit_paise into v_deficit from public.paper_accounts
   where user_id='abababab-abab-4bab-8bab-abababababab';
  if v_deficit<>10000 then raise exception 'Initial available-funds deficit was not exposed'; end if;

  -- Daily MTM: long 25 * (11000 - 10000) = +25000 paise.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.post_paper_futures_daily_mtm(
    'abababab-abab-4bab-8bab-abababababab','NSE_FO|RISK_TEST',current_date-1,
    11000,'risk-mtm-day-1',repeat('a',64),
    'https://www.nseindia.com/all-reports-derivatives',repeat('b',64),v_now,v_now
  );
  if (v_result->>'cash_delta_paise')::bigint<>25000
     or (v_result->>'settlement_version')::bigint<>1 then
    raise exception 'Daily Futures MTM did not post expected variation: %',v_result;
  end if;
  select cash_paise,reserved_margin_paise,realized_pnl_paise,margin_deficit_paise
    into v_cash,v_margin,v_realized,v_deficit from public.paper_accounts
   where user_id='abababab-abab-4bab-8bab-abababababab';
  select average_price_paise,net_quantity,realized_pnl_paise
    into v_avg,v_qty,v_realized from public.paper_futures_positions
   where user_id='abababab-abab-4bab-8bab-abababababab'
     and instrument_key='NSE_FO|RISK_TEST';
  if v_cash<>115000 or v_margin<>100000 or v_avg<>11000 or v_qty<>25
     or v_realized<>25000 or v_deficit<>0 then
    raise exception 'Daily MTM cash/basis/quantity reconciliation failed';
  end if;

  -- Exact replay does not post a second cash effect. Changed payload is rejected.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.post_paper_futures_daily_mtm(
    'abababab-abab-4bab-8bab-abababababab','NSE_FO|RISK_TEST',current_date-1,
    11000,'risk-mtm-day-1',repeat('a',64),
    'https://www.nseindia.com/all-reports-derivatives',repeat('b',64),v_now,v_now
  );
  if (v_result->>'idempotent_replay')::boolean is not true then
    raise exception 'Daily MTM replay was not idempotent';
  end if;
  v_rejected:=false;
  begin
    perform public.post_paper_futures_daily_mtm(
      'abababab-abab-4bab-8bab-abababababab','NSE_FO|RISK_TEST',current_date-1,
      11000,'risk-mtm-day-1',repeat('c',64),
      'https://www.nseindia.com/all-reports-derivatives',repeat('b',64),v_now,v_now
    );
  exception when sqlstate '23505' then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Changed MTM payload reused an existing event key'; end if;

  -- Down day: 25 * (10500 - 11000) = -12500 paise.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.post_paper_futures_daily_mtm(
    'abababab-abab-4bab-8bab-abababababab','NSE_FO|RISK_TEST',current_date,
    10500,'risk-mtm-day-2',repeat('d',64),
    'https://www.nseindia.com/all-reports-derivatives',repeat('e',64),v_now,v_now
  );
  if (v_result->>'cash_delta_paise')::bigint<>-12500 then
    raise exception 'Negative daily MTM sign is incorrect: %',v_result;
  end if;
  select cash_paise,realized_pnl_paise into v_cash,v_realized
    from public.paper_accounts where user_id='abababab-abab-4bab-8bab-abababababab';
  if v_cash<>102500 or v_realized<>12500 then
    raise exception 'Daily MTM did not update account cash and realized P&L exactly once';
  end if;

  -- Create a pending LIMIT order; it seeds UNKNOWN until provider margin refresh.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  insert into public.paper_futures_orders(
    order_id,user_id,idempotency_key,request_fingerprint,instrument_key,
    trading_symbol,exchange,segment,expiry,lot_size,side,product,order_type,
    status,quantity,limit_price_paise,tick_size_paise,margin_reserved_paise,
    charges_paise,realized_pnl_paise,quote_timestamp_ms,quote_age_ms,
    reservation_released,simulation_only,filled_quantity,remaining_quantity,
    average_fill_price_paise,reserved_open_margin_paise,reserved_close_quantity,expires_at
  ) values (
    repeat('8',64),'abababab-abab-4bab-8bab-abababababab',
    'abababab-0000-4000-8000-000000000098',repeat('8',64),
    'NSE_FO|RISK_TEST','RISK_TEST','NSE','NSE_FO',current_date+10,25,
    'BUY','DELIVERY','LIMIT','PENDING',25,11000,5,0,0,0,v_now,0,
    false,true,0,25,null,0,0,clock_timestamp()+interval '5 minutes'
  );

  -- Initial and maintenance margin must be provider-sourced. Maintenance above
  -- the reserved initial requirement creates a MARGIN_CALL and deficit.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.refresh_paper_futures_margin(
    'abababab-abab-4bab-8bab-abababababab','NSE_FO|RISK_TEST',
    120000,130000,'UPSTOX','https://api.upstox.com/v2/charges/margin',
    repeat('f',64),v_now,'risk-margin-1',repeat('1',64),v_now
  );
  if v_result->>'risk_status'<>'MARGIN_CALL'
     or (v_result->>'margin_delta_paise')::bigint<>20000 then
    raise exception 'Maintenance shortfall did not set MARGIN_CALL: %',v_result;
  end if;
  select reserved_margin_paise,margin_deficit_paise into v_margin,v_deficit
    from public.paper_accounts where user_id='abababab-abab-4bab-8bab-abababababab';
  if v_margin<>120000 or v_deficit<>17500 then
    raise exception 'Provider initial margin or margin deficit did not reconcile';
  end if;

  -- MARGIN_CALL blocks risk-increasing orders, but the explicit square-off path
  -- below remains available to close the position.
  v_rejected:=false;
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  begin
    insert into public.paper_futures_orders(
      order_id,user_id,idempotency_key,request_fingerprint,instrument_key,
      trading_symbol,exchange,segment,expiry,lot_size,side,product,order_type,
      status,quantity,limit_price_paise,tick_size_paise,margin_reserved_paise,
      charges_paise,realized_pnl_paise,quote_timestamp_ms,quote_age_ms,
      reservation_released,simulation_only,filled_quantity,remaining_quantity,
      average_fill_price_paise,reserved_open_margin_paise,reserved_close_quantity,expires_at
    ) values (
      repeat('7',64),'abababab-abab-4bab-8bab-abababababab',
      'abababab-0000-4000-8000-000000000097',repeat('7',64),
      'NSE_FO|RISK_TEST','RISK_TEST','NSE','NSE_FO',current_date+10,25,
      'BUY','DELIVERY','LIMIT','PENDING',25,11000,5,0,0,0,v_now,0,
      false,true,0,25,null,0,0,clock_timestamp()+interval '5 minutes'
    );
  exception when sqlstate '55000' then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Risk-increasing order passed during MARGIN_CALL'; end if;

  -- Paper square-off realizes from the last MTM basis, books charges, cancels
  -- pending LIMIT orders and releases all position/open-order margin.
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.close_paper_futures_position(
    'abababab-abab-4bab-8bab-abababababab','NSE_FO|RISK_TEST',
    'SIMULATED_SQUARE_OFF',current_date,9000,1000,
    'risk-squareoff-1',repeat('2',64),'UPSTOX_QUOTE',
    'https://api.upstox.com/v2/market-quote/quotes',repeat('3',64),v_now,v_now
  );
  if (v_result->>'realized_pnl_paise')::bigint<>-37500
     or (v_result->>'released_margin_paise')::bigint<>120000
     or (v_result->>'cash_delta_paise')::bigint<>-38500 then
    raise exception 'Square-off P&L, charges or margin release is incorrect: %',v_result;
  end if;
  select cash_paise,reserved_margin_paise,realized_pnl_paise
    into v_cash,v_margin,v_realized from public.paper_accounts
   where user_id='abababab-abab-4bab-8bab-abababababab';
  if v_cash<>64000 or v_margin<>0 or v_realized<>-25000
     or exists(select 1 from public.paper_futures_positions
       where user_id='abababab-abab-4bab-8bab-abababababab'
         and instrument_key='NSE_FO|RISK_TEST') then
    raise exception 'Square-off did not reconcile account and position';
  end if;
  select risk_status into v_status from public.paper_futures_risk_state
   where user_id='abababab-abab-4bab-8bab-abababababab'
     and instrument_key='NSE_FO|RISK_TEST';
  if v_status<>'CLOSED' then raise exception 'Closed risk state is not terminal'; end if;

  -- Expiry close: short 25 * (9500 - 10000) = +12500 paise; release 60000 margin.
  update public.paper_accounts set reserved_margin_paise=60000
   where user_id='abababab-abab-4bab-8bab-abababababab';
  insert into public.paper_futures_positions(
    user_id,instrument_key,trading_symbol,exchange,segment,expiry,product,
    lot_size,tick_size_paise,net_quantity,average_price_paise,
    reserved_margin_paise,realized_pnl_paise,reserved_close_quantity
  ) values (
    'abababab-abab-4bab-8bab-abababababab','NSE_FO|EXPIRY_TEST','EXPIRY_TEST',
    'NSE','NSE_FO',current_date-1,'DELIVERY',25,5,-25,10000,60000,0,25
  );
  insert into public.paper_futures_orders(
    order_id,user_id,idempotency_key,request_fingerprint,instrument_key,
    trading_symbol,exchange,segment,expiry,lot_size,side,product,order_type,
    status,quantity,limit_price_paise,tick_size_paise,margin_reserved_paise,
    charges_paise,realized_pnl_paise,reservation_released,simulation_only,
    filled_quantity,remaining_quantity,average_fill_price_paise,
    reserved_open_margin_paise,reserved_close_quantity,expires_at
  ) values (
    repeat('9',64),'abababab-abab-4bab-8bab-abababababab',
    'abababab-0000-4000-8000-000000000099',repeat('9',64),
    'NSE_FO|EXPIRY_TEST','EXPIRY_TEST','NSE','NSE_FO',current_date-1,25,
    'BUY','DELIVERY','LIMIT','PENDING',25,10000,5,0,0,0,false,true,
    0,25,null,0,25,clock_timestamp()+interval '5 minutes'
  );
  v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_result:=public.close_paper_futures_position(
    'abababab-abab-4bab-8bab-abababababab','NSE_FO|EXPIRY_TEST',
    'EXPIRY_SETTLEMENT',current_date,9500,500,
    'risk-expiry-1',repeat('4',64),'NSE_OFFICIAL_FINAL_SETTLEMENT',
    'https://www.nseindia.com/all-reports-derivatives',repeat('5',64),v_now,v_now
  );
  if (v_result->>'realized_pnl_paise')::bigint<>12500
     or (v_result->>'released_margin_paise')::bigint<>60000
     or (v_result->>'released_close_quantity')::integer<>25 then
    raise exception 'Expiry settlement did not reconcile: %',v_result;
  end if;
  if exists(select 1 from public.paper_futures_orders
       where order_id=repeat('9',64) and status<>'EXPIRED')
     or exists(select 1 from public.paper_futures_positions
       where user_id='abababab-abab-4bab-8bab-abababababab'
         and instrument_key='NSE_FO|EXPIRY_TEST') then
    raise exception 'Expiry settlement left a live order or position';
  end if;

  -- Append-only ledger and client privilege boundaries.
  v_rejected:=false;
  begin
    update public.paper_futures_risk_events set cash_delta_paise=0
     where user_id='abababab-abab-4bab-8bab-abababababab'
       and event_key='risk-mtm-day-1';
  exception when sqlstate '55000' then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Risk ledger UPDATE was not blocked'; end if;
  select count(*) into v_count from public.paper_futures_risk_events
   where user_id='abababab-abab-4bab-8bab-abababababab';
  if v_count<>5 then raise exception 'Unexpected risk event count: %',v_count; end if;

  if has_table_privilege('authenticated','public.paper_futures_risk_events','INSERT')
     or has_table_privilege('authenticated','public.paper_futures_risk_events','UPDATE')
     or has_table_privilege('authenticated','public.paper_futures_risk_events','DELETE')
     or has_table_privilege('anon','public.paper_futures_risk_events','SELECT') then
    raise exception 'Futures risk ledger exposes an unsafe client privilege';
  end if;
  if has_function_privilege('authenticated',
    'public.post_paper_futures_daily_mtm(uuid,text,date,bigint,text,text,text,text,bigint,bigint)','EXECUTE')
     or has_function_privilege('anon',
    'public.close_paper_futures_position(uuid,text,text,date,bigint,bigint,text,text,text,text,text,bigint,bigint)','EXECUTE') then
    raise exception 'Privileged Futures risk RPC is executable by client roles';
  end if;
end
$futures_risk$;
rollback;
