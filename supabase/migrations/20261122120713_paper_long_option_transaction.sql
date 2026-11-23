-- DRAFT ONLY. Do not apply until staging parity tests and explicit approval.
-- Long CE/PE MARKET BUY and SELL-to-close; mirrors Firebase gateway contract.
-- Trusted backend must validate authenticated identity and provider instrument/quote.
-- All money values are integer paise. SQL function is service_role-only.

alter table public.paper_derivative_positions
  add column if not exists exchange text check (exchange is null or exchange in ('NSE','BSE')),
  add column if not exists lot_size integer check (lot_size is null or lot_size > 0);

create or replace function public.execute_paper_long_option_order(
  p_user_id uuid,
  p_order_id text,
  p_idempotency_key uuid,
  p_request_fingerprint text,
  p_instrument_key text,
  p_trading_symbol text,
  p_exchange text,
  p_segment text,
  p_instrument_type text,
  p_expiry date,
  p_strike_price numeric,
  p_lot_size integer,
  p_tick_size_paise integer,
  p_lots integer,
  p_side text,
  p_execution_price_paise bigint,
  p_quote_timestamp_ms bigint,
  p_now_ms bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.paper_accounts%rowtype;
  v_existing public.paper_derivative_orders%rowtype;
  v_position public.paper_derivative_positions%rowtype;
  v_has_position boolean := false;
  v_quantity bigint;
  v_gross bigint;
  v_quote_age bigint;
  v_expiry_cutoff_ms numeric;
  v_exchange_rate numeric;
  v_ipft_rate numeric;
  v_exchange_fee bigint;
  v_ipft bigint;
  v_sebi bigint;
  v_stamp bigint;
  v_stt bigint;
  v_brokerage bigint := 2000;
  v_gst bigint;
  v_charges bigint;
  v_total_debit bigint;
  v_net_credit bigint;
  v_cash_delta bigint;
  v_cash bigint;
  v_old_qty bigint := 0;
  v_old_avg bigint := 0;
  v_old_basis bigint := 0;
  v_new_qty bigint;
  v_new_basis bigint;
  v_new_avg bigint;
  v_closed_basis bigint := 0;
  v_order_realized bigint := 0;
  v_realized bigint;
  v_open_count bigint;
  v_fingerprint text;
  v_order jsonb;
  v_server_now_ms bigint;
begin
  if p_user_id is null or p_idempotency_key is null
     or p_order_id !~ '^[a-f0-9]{64}$'
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_instrument_key is null or length(p_instrument_key) not between 1 and 100
     or p_trading_symbol is null or length(p_trading_symbol) = 0
     or p_exchange is null or p_exchange not in ('NSE','BSE')
     or p_segment is null or p_segment not in ('NSE_FO','BSE_FO')
     or p_instrument_type is null or p_instrument_type not in ('CE','PE')
     or (p_exchange='NSE' and p_segment<>'NSE_FO')
     or (p_exchange='BSE' and p_segment<>'BSE_FO')
     or p_expiry is null or p_strike_price is null
     or p_strike_price::text in ('NaN','Infinity','-Infinity') or p_strike_price<=0
     or p_lot_size is null or p_lot_size not between 1 and 1000000
     or p_tick_size_paise is null or p_tick_size_paise not between 1 and 1000000
     or p_lots is null or p_lots not between 1 and 10000
     or p_side is null or p_side not in ('BUY','SELL')
     or p_execution_price_paise is null
     or p_quote_timestamp_ms is null or p_now_ms is null
     or p_idempotency_key is null or p_order_id is null or p_request_fingerprint is null
     or p_execution_price_paise<=0
     or p_execution_price_paise % p_tick_size_paise <> 0
     or p_quote_timestamp_ms<0 or p_now_ms<0
  then raise exception 'Invalid or unsupported option contract/order input.' using errcode='22023'; end if;

  v_quantity := p_lots::bigint * p_lot_size::bigint;
  if v_quantity not between 1 and 1000000 then
    raise exception 'Contract quantity exceeds supported limits.' using errcode='22003';
  end if;
  v_gross := p_execution_price_paise * v_quantity;
  if v_gross<=0 or v_gross>9007199254740991 then
    raise exception 'Contract value exceeds safe integer paise limits.' using errcode='22003';
  end if;

  -- Use the database clock, and reject a caller clock that is not current.
  v_server_now_ms := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if abs(v_server_now_ms-p_now_ms)>2000 then
    raise exception 'Option quote clock is not current.' using errcode='22023';
  end if;
  v_quote_age := v_server_now_ms - p_quote_timestamp_ms;
  if not public._paper_quote_age_is_fresh(p_quote_timestamp_ms,v_server_now_ms) then
    raise exception 'A matching fresh provider quote is required.' using errcode='22023';
  end if;

  -- Expiry-day 15:30 Asia/Kolkata cutoff, represented as UTC epoch milliseconds.
  v_expiry_cutoff_ms :=
    extract(epoch from ((p_expiry + time '15:30') at time zone 'Asia/Kolkata')) * 1000;
  if v_server_now_ms > v_expiry_cutoff_ms then
    raise exception 'Expired derivative contracts cannot be traded.' using errcode='22023';
  end if;

  -- Account-first lock serializes all order writes and duplicate retries.
  select * into v_account
    from public.paper_accounts
    where user_id=p_user_id
    for update;
  if not found then raise exception 'Paper account is not initialized.' using errcode='P0002'; end if;

  if v_account.cash_paise<0
     or v_account.reserved_cash_paise<0
     or v_account.reserved_margin_paise<>0
     or v_account.reserved_cash_paise+v_account.reserved_margin_paise>v_account.cash_paise
     or v_account.version<1
     or v_account.version>=9007199254740991
     or abs(v_account.realized_pnl_paise::numeric)>9007199254740991
  then raise exception 'Paper account contains invalid or unsupported balance data.' using errcode='23514'; end if;

  select * into v_existing
    from public.paper_derivative_orders
    where order_id=p_order_id
    for update;
  if found then
    if v_existing.user_id<>p_user_id then
      raise exception 'Stored derivative order does not belong to this account.' using errcode='23505';
    end if;
    if v_existing.idempotency_key is distinct from p_idempotency_key
       or v_existing.request_fingerprint is distinct from p_request_fingerprint then
      raise exception 'Idempotency key was reused for a different request.' using errcode='23505';
    end if;
    return jsonb_build_object(
      'order_id',v_existing.order_id,'status',v_existing.status,
      'cash_paise',v_account.cash_paise,'realized_pnl_paise',v_account.realized_pnl_paise,
      'idempotent_replay',true,'simulation_only',true
    );
  end if;

  -- Also guard the user/key unique constraint if caller supplied a different order id.
  if exists(select 1 from public.paper_derivative_orders
            where user_id=p_user_id and idempotency_key=p_idempotency_key) then
    raise exception 'Idempotency key already belongs to another order reference.' using errcode='23505';
  end if;

  select * into v_position
    from public.paper_derivative_positions
    where user_id=p_user_id and instrument_key=p_instrument_key
    for update;
  v_has_position := found;
  if v_has_position then
    if v_position.instrument_type<>p_instrument_type
       or (v_position.exchange is not null and v_position.exchange<>p_exchange)
       or (v_position.segment is not null and v_position.segment<>p_segment)
       or (v_position.expiry is not null and v_position.expiry<>p_expiry)
       or (v_position.lot_size is not null and v_position.lot_size<>p_lot_size)
       or v_position.net_quantity<=0
       or v_position.average_price_paise<=0
       or v_position.cost_basis_paise<=0
       or abs(v_position.cost_basis_paise::numeric)>9007199254740991
       or round(v_position.cost_basis_paise::numeric/v_position.net_quantity)<>v_position.average_price_paise
    then raise exception 'Stored option position metadata or cost basis is invalid.' using errcode='23514'; end if;
    v_old_qty:=v_position.net_quantity;
    v_old_avg:=v_position.average_price_paise;
    v_old_basis:=v_position.cost_basis_paise;
  end if;

  if p_side='SELL' and (not v_has_position or v_old_qty<v_quantity) then
    raise exception 'SELL is allowed only to close an existing long option position.' using errcode='23514';
  end if;

  if p_side='BUY' and not v_has_position then
    select count(*) into v_open_count
      from public.paper_derivative_positions
      where user_id=p_user_id and net_quantity>0;
    if v_open_count>=50 then
      raise exception 'Derivative portfolio is limited to 50 open positions.' using errcode='23514';
    end if;
  end if;

  -- Fee rates mirror trading-charges.js; floor(x + 0.5) reproduces positive Math.round.
  if p_exchange='NSE' then
    v_exchange_rate:=0.0003553;
    v_ipft_rate:=0.000005;
  else
    v_exchange_rate:=0.000325;
    v_ipft_rate:=0;
  end if;
  v_exchange_fee:=floor(v_gross::numeric*v_exchange_rate+0.5)::bigint;
  v_ipft:=floor(v_gross::numeric*v_ipft_rate+0.5)::bigint;
  v_sebi:=floor(v_gross::numeric*0.000001+0.5)::bigint;
  v_stamp:=case when p_side='BUY' then floor(v_gross::numeric*0.00003+0.5)::bigint else 0 end;
  v_stt:=case when p_side='SELL' then floor(v_gross::numeric*0.0015+0.5)::bigint else 0 end;
  v_gst:=floor((v_brokerage+v_exchange_fee+v_ipft)::numeric*0.18+0.5)::bigint;
  v_charges:=v_brokerage+v_exchange_fee+v_ipft+v_sebi+v_stamp+v_gst+v_stt;
  if v_charges>9007199254740991 then
    raise exception 'Option charges exceed safe calculation limits.' using errcode='22003';
  end if;
  v_total_debit:=case when p_side='BUY' then v_gross+v_charges else null end;
  v_net_credit:=case when p_side='SELL' then v_gross-v_charges else null end;
  v_cash_delta:=case when p_side='BUY' then -v_gross else v_gross end;
  v_cash:=v_account.cash_paise+v_cash_delta-v_charges;
  if abs(v_cash::numeric)>9007199254740991
     or v_cash < v_account.reserved_cash_paise+v_account.reserved_margin_paise then
    raise exception 'Insufficient unreserved paper cash or safe balance limit exceeded.' using errcode='23514';
  end if;

  if p_side='BUY' then
    v_new_qty:=v_old_qty+v_quantity;
    v_new_basis:=v_old_basis+v_gross+v_charges;
    if v_new_qty>1000000 or v_new_basis>9007199254740991 then
      raise exception 'Option position exceeds supported calculation limits.' using errcode='22003';
    end if;
    -- Mirror Firebase: average price is rounded fee-inclusive cost basis per unit.
    v_new_avg:=floor(v_new_basis::numeric/v_new_qty+0.5)::bigint;
  else
    if v_quantity=v_old_qty then
      v_closed_basis:=v_old_basis;
    else
      v_closed_basis:=floor((v_old_basis::numeric*v_quantity+floor(v_old_qty::numeric/2))/v_old_qty)::bigint;
    end if;
    v_new_qty:=v_old_qty-v_quantity;
    v_new_basis:=v_old_basis-v_closed_basis;
    v_order_realized:=v_gross-v_closed_basis-v_charges;
    if v_new_qty>0 then v_new_avg:=floor(v_new_basis::numeric/v_new_qty+0.5)::bigint;
    else v_new_avg:=0; end if;
  end if;

  v_realized:=v_account.realized_pnl_paise+v_order_realized;
  if abs(v_realized::numeric)>9007199254740991
     or abs(v_order_realized::numeric)>9007199254740991 then
    raise exception 'Realized option P&L exceeds safe calculation limits.' using errcode='22003';
  end if;

  if v_new_qty=0 then
    delete from public.paper_derivative_positions
      where user_id=p_user_id and instrument_key=p_instrument_key;
  else
    insert into public.paper_derivative_positions(
      user_id,instrument_key,trading_symbol,segment,exchange,instrument_type,expiry,
      lot_size,net_quantity,average_price_paise,cost_basis_paise,updated_at
    ) values (
      p_user_id,p_instrument_key,p_trading_symbol,p_segment,p_exchange,p_instrument_type,p_expiry,
      p_lot_size,v_new_qty,v_new_avg,v_new_basis,now()
    )
    on conflict(user_id,instrument_key) do update set
      trading_symbol=excluded.trading_symbol,segment=excluded.segment,exchange=excluded.exchange,
      instrument_type=excluded.instrument_type,expiry=excluded.expiry,lot_size=excluded.lot_size,
      net_quantity=excluded.net_quantity,average_price_paise=excluded.average_price_paise,
      cost_basis_paise=excluded.cost_basis_paise,updated_at=now();
  end if;

  insert into public.paper_derivative_orders(
    order_id,user_id,idempotency_key,request_fingerprint,instrument_key,trading_symbol,
    exchange,segment,instrument_type,expiry,strike_price,side,quantity,lots,lot_size,order_type,status,
    execution_price_paise,quote_timestamp_ms,quote_age_ms,gross_paise,charges_paise,
    total_debit_paise,net_credit_paise,realized_pnl_paise,cash_delta_paise,
    charges_breakdown,excludes_charges,simulation_only,created_at
  ) values (
    p_order_id,p_user_id,p_idempotency_key,p_request_fingerprint,p_instrument_key,p_trading_symbol,
    p_exchange,p_segment,p_instrument_type,p_expiry,p_strike_price,p_side,v_quantity,p_lots,p_lot_size,'MARKET','FILLED',
    p_execution_price_paise,p_quote_timestamp_ms,v_quote_age,v_gross,v_charges,
    v_total_debit,v_net_credit,v_order_realized,v_cash_delta,
    jsonb_build_object(
      'grossPaise',v_gross,'brokeragePaise',v_brokerage,
      'exchangeTransactionPaise',v_exchange_fee,'ipftPaise',v_ipft,
      'sebiPaise',v_sebi,'stampDutyPaise',v_stamp,'gstPaise',v_gst,'sttPaise',v_stt,
      'totalChargesPaise',v_charges,'totalDebitPaise',v_total_debit,
      'netCreditPaise',v_net_credit,'exchange',p_exchange,'side',p_side,
      'segment','EQUITY_OPTIONS','indicative',true,'simulationOnly',true
    ),false,true,now()
  );

  update public.paper_accounts set
    cash_paise=v_cash,
    realized_pnl_paise=v_realized,
    updated_at=now(),
    version=version+1
  where user_id=p_user_id;

  select to_jsonb(o) into v_order
    from public.paper_derivative_orders o where o.order_id=p_order_id;
  return jsonb_build_object(
    'order_id',p_order_id,'order',v_order,'cash_paise',v_cash,
    'realized_pnl_paise',v_realized,'idempotent_replay',false,'simulation_only',true
  );
end;
$$;

revoke all on function public.execute_paper_long_option_order(
  uuid,text,uuid,text,text,text,text,text,text,date,numeric,integer,integer,integer,text,bigint,bigint,bigint
) from public, anon, authenticated;
grant execute on function public.execute_paper_long_option_order(
  uuid,text,uuid,text,text,text,text,text,text,date,numeric,integer,integer,integer,text,bigint,bigint,bigint
) to service_role;
