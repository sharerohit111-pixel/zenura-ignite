-- DRAFT ONLY. Atomic NSE long-option LIMIT submit/cancel/expiry.
-- No fill RPC, worker, order route, feature activation or production deployment is included.

create or replace function public.submit_paper_option_limit_order(
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
  p_side text,
  p_quantity integer,
  p_limit_price_paise bigint,
  p_now_ms bigint,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.paper_accounts%rowtype;
  v_existing public.paper_option_limit_orders%rowtype;
  v_position public.paper_derivative_positions%rowtype;
  v_has_position boolean := false;
  v_server_now timestamptz;
  v_server_now_ms bigint;
  v_local_date date;
  v_local_minute integer;
  v_session public.paper_exchange_sessions%rowtype;
  v_session_close timestamptz;
  v_gross_numeric numeric;
  v_gross bigint;
  v_exchange_fee bigint;
  v_ipft bigint;
  v_sebi bigint;
  v_stamp bigint;
  v_gst bigint;
  v_charges bigint;
  v_reserved_cash bigint := 0;
  v_available_cash bigint;
  v_open_count integer;
begin
  if p_user_id is null
     or p_order_id is null or p_order_id !~ '^[a-f0-9]{64}$'
     or p_idempotency_key is null
     or p_request_fingerprint is null or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_instrument_key is null or length(p_instrument_key) not between 1 and 160
     or p_trading_symbol is null or length(p_trading_symbol) not between 1 and 80
     or p_exchange is distinct from 'NSE'
     or p_segment is distinct from 'NSE_FO'
     or p_instrument_type is null or p_instrument_type not in ('CE','PE')
     or p_expiry is null
     or p_strike_price is null or p_strike_price<=0
     or p_strike_price::text in ('NaN','Infinity','-Infinity')
     or p_lot_size is null or p_lot_size not between 1 and 1000000
     or p_tick_size_paise is null or p_tick_size_paise not between 1 and 1000000
     or p_side is null or p_side not in ('BUY','SELL')
     or p_quantity is null or p_quantity not between 1 and 1000000
     or p_quantity % p_lot_size <> 0
     or p_limit_price_paise is null or p_limit_price_paise<=0
     or p_limit_price_paise % p_tick_size_paise<>0
     or p_now_ms is null or p_now_ms<=0
     or p_expires_at is null then
    raise exception 'Invalid or unsupported NSE Options LIMIT order input.' using errcode='22023';
  end if;

  -- One global write order across MARKET and LIMIT flows: account -> order -> position.
  select * into v_account
    from public.paper_accounts
   where user_id=p_user_id
   for update;
  if not found then
    raise exception 'Paper Trading account is not initialized.' using errcode='P0002';
  end if;
  if v_account.cash_paise<0 or v_account.reserved_cash_paise<0
     or v_account.reserved_margin_paise<0
     or v_account.reserved_cash_paise+v_account.reserved_margin_paise>v_account.cash_paise then
    raise exception 'Paper account reservations are inconsistent.' using errcode='23514';
  end if;

  select * into v_existing
    from public.paper_option_limit_orders
   where user_id=p_user_id and idempotency_key=p_idempotency_key
   for update;
  if found then
    if v_existing.order_id<>p_order_id
       or v_existing.request_fingerprint<>p_request_fingerprint then
      raise exception 'Options LIMIT idempotency key was reused with different order details.' using errcode='23505';
    end if;
    return jsonb_build_object(
      'order_id',v_existing.order_id,'status',v_existing.status,
      'filled_quantity',v_existing.filled_quantity,
      'remaining_quantity',v_existing.remaining_quantity,
      'reserved_cash_paise',v_existing.reserved_cash_paise,
      'reserved_close_quantity',v_existing.reserved_close_quantity,
      'idempotent_replay',true,'simulation_only',true
    );
  end if;

  v_server_now:=clock_timestamp();
  v_server_now_ms:=floor(extract(epoch from v_server_now)*1000)::bigint;
  v_local_date:=(v_server_now at time zone 'Asia/Kolkata')::date;
  v_local_minute:=extract(hour from (v_server_now at time zone 'Asia/Kolkata'))::integer*60
    +extract(minute from (v_server_now at time zone 'Asia/Kolkata'))::integer;
  select * into v_session
    from public.paper_exchange_sessions
   where exchange='NSE' and session_date=v_local_date
     and is_trading_day is true and session_kind in ('REGULAR','SPECIAL')
     and verified_at<=v_server_now
     and length(btrim(source_reference)) between 1 and 500
     and source_sha256 ~ '^[a-f0-9]{64}$'
     and lower(source_reference) ~ '^https://([a-z0-9-]+[.])*nseindia[.]com(/|$)';
  if not found or abs(v_server_now_ms-p_now_ms)>2000
     or p_expiry<v_local_date
     or p_expires_at<=v_server_now
     or p_expires_at>((p_expiry + time '15:30') at time zone 'Asia/Kolkata')
     or v_local_minute<v_session.open_minute
     or v_local_minute>=v_session.close_minute then
    raise exception 'Fresh clock and verified open NSE session are required for Options LIMIT submit.' using errcode='22023';
  end if;
  v_session_close:=(v_local_date::timestamp
    +make_interval(mins=>v_session.close_minute)) at time zone 'Asia/Kolkata';
  if p_expires_at>v_session_close then
    raise exception 'Options LIMIT expiry cannot exceed the verified NSE session close.' using errcode='22023';
  end if;

  select * into v_position
    from public.paper_derivative_positions
   where user_id=p_user_id and instrument_key=p_instrument_key
   for update;
  v_has_position:=found;
  if v_has_position then
    if v_position.instrument_type<>p_instrument_type
       or v_position.exchange is distinct from p_exchange
       or v_position.segment is distinct from p_segment
       or v_position.expiry is distinct from p_expiry
       or v_position.lot_size is distinct from p_lot_size
       or v_position.net_quantity<=0
       or v_position.reserved_quantity<0
       or v_position.reserved_quantity>v_position.net_quantity then
      raise exception 'Options LIMIT contract or long-position metadata does not match.' using errcode='23514';
    end if;
  end if;

  if p_side='BUY' then
    if not v_has_position then
      select count(*) into v_open_count
        from public.paper_derivative_positions
       where user_id=p_user_id and net_quantity>0;
      if v_open_count>=50 then
        raise exception 'Derivative portfolio is limited to 50 open positions.' using errcode='23514';
      end if;
    end if;

    v_gross_numeric:=p_limit_price_paise::numeric*p_quantity::numeric;
    if v_gross_numeric<=0 or v_gross_numeric>9007199254740991 then
      raise exception 'Options LIMIT notional exceeds supported safe integer limits.' using errcode='22003';
    end if;
    v_gross:=v_gross_numeric::bigint;
    -- Must stay in parity with calculateLongOptionTradeCharges and the MARKET RPC.
    v_exchange_fee:=floor(v_gross::numeric*0.0003552+0.5)::bigint;
    v_ipft:=floor(v_gross::numeric*0.000000001+0.5)::bigint;
    v_sebi:=floor(v_gross::numeric*0.000001+0.5)::bigint;
    v_stamp:=floor(v_gross::numeric*0.00003+0.5)::bigint;
    v_gst:=floor((2000+v_exchange_fee+v_ipft)::numeric*0.18+0.5)::bigint;
    v_charges:=2000+v_exchange_fee+v_ipft+v_sebi+v_stamp+v_gst;
    v_reserved_cash:=v_gross+v_charges;
    if v_reserved_cash>9007199254740991 then
      raise exception 'Options LIMIT cash reservation exceeds supported safe integer limits.' using errcode='22003';
    end if;
    v_available_cash:=v_account.cash_paise-v_account.reserved_cash_paise-v_account.reserved_margin_paise;
    if v_reserved_cash>v_available_cash then
      raise exception 'Insufficient unreserved virtual cash for Options LIMIT order.' using errcode='23514';
    end if;
    update public.paper_accounts
       set reserved_cash_paise=reserved_cash_paise+v_reserved_cash,
           version=version+1,updated_at=now()
     where user_id=p_user_id;
  else
    if not v_has_position
       or p_quantity>v_position.net_quantity-v_position.reserved_quantity then
      raise exception 'Options SELL LIMIT can only reserve unreserved quantity from an existing long position.' using errcode='23514';
    end if;
    update public.paper_derivative_positions
       set reserved_quantity=reserved_quantity+p_quantity,updated_at=now()
     where user_id=p_user_id and instrument_key=p_instrument_key;
  end if;

  insert into public.paper_option_limit_orders(
    order_id,user_id,idempotency_key,request_fingerprint,instrument_key,trading_symbol,
    exchange,segment,instrument_type,expiry,strike_price,lot_size,tick_size_paise,
    side,quantity,filled_quantity,remaining_quantity,limit_price_paise,
    reserved_cash_paise,reserved_close_quantity,status,expires_at,
    reservation_released,simulation_only,created_at,updated_at
  ) values (
    p_order_id,p_user_id,p_idempotency_key,p_request_fingerprint,p_instrument_key,p_trading_symbol,
    p_exchange,p_segment,p_instrument_type,p_expiry,p_strike_price,p_lot_size,p_tick_size_paise,
    p_side,p_quantity,0,p_quantity,p_limit_price_paise,
    case when p_side='BUY' then v_reserved_cash else 0 end,
    case when p_side='SELL' then p_quantity else 0 end,
    'PENDING',p_expires_at,false,true,now(),now()
  );

  return jsonb_build_object(
    'order_id',p_order_id,'status','PENDING','filled_quantity',0,
    'remaining_quantity',p_quantity,
    'reserved_cash_paise',case when p_side='BUY' then v_reserved_cash else 0 end,
    'reserved_close_quantity',case when p_side='SELL' then p_quantity else 0 end,
    'idempotent_replay',false,'simulation_only',true
  );
end;
$$;

create or replace function public._release_paper_option_limit_order(
  p_order_id text,
  p_target_status text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_account public.paper_accounts%rowtype;
  v_order public.paper_option_limit_orders%rowtype;
  v_position public.paper_derivative_positions%rowtype;
  v_cash_release bigint;
  v_close_release integer;
  v_now timestamptz;
  v_local_date date;
  v_local_minute integer;
  v_session public.paper_exchange_sessions%rowtype;
begin
  if p_order_id is null or p_order_id !~ '^[a-f0-9]{64}$'
     or p_target_status is null or p_target_status not in ('CANCELLED','EXPIRED') then
    raise exception 'Invalid Options LIMIT release request.' using errcode='22023';
  end if;

  select user_id into v_user_id
    from public.paper_option_limit_orders
   where order_id=p_order_id;
  if not found then
    raise exception 'Options LIMIT order was not found.' using errcode='P0002';
  end if;

  select * into v_account
    from public.paper_accounts where user_id=v_user_id for update;
  if not found then
    raise exception 'Paper Trading account is not initialized.' using errcode='P0002';
  end if;

  select * into v_order
    from public.paper_option_limit_orders
   where order_id=p_order_id and user_id=v_user_id
   for update;
  if not found then
    raise exception 'Options LIMIT order ownership changed.' using errcode='P0002';
  end if;

  if v_order.status in ('CANCELLED','EXPIRED','FILLED','REJECTED') then
    return jsonb_build_object(
      'order_id',v_order.order_id,'status',v_order.status,
      'released_cash_paise',0,'released_close_quantity',0,
      'idempotent_replay',true,'simulation_only',true
    );
  end if;

  if p_target_status='EXPIRED' then
    v_now:=clock_timestamp();
    if v_order.expires_at>v_now
       and v_now<((v_order.expiry + time '15:30') at time zone 'Asia/Kolkata') then
      v_local_date:=(v_now at time zone 'Asia/Kolkata')::date;
      v_local_minute:=extract(hour from (v_now at time zone 'Asia/Kolkata'))::integer*60
        +extract(minute from (v_now at time zone 'Asia/Kolkata'))::integer;
      select * into v_session
        from public.paper_exchange_sessions
       where exchange='NSE' and session_date=v_local_date
         and is_trading_day is true and session_kind in ('REGULAR','SPECIAL')
         and verified_at<=v_now
         and length(btrim(source_reference)) between 1 and 500
         and source_sha256 ~ '^[a-f0-9]{64}$'
         and lower(source_reference) ~ '^https://([a-z0-9-]+[.])*nseindia[.]com(/|$)';
      if found and v_local_minute>=v_session.open_minute
         and v_local_minute<v_session.close_minute then
        raise exception 'Options LIMIT order is still inside a verified NSE session.' using errcode='22023';
      end if;
    end if;
  end if;

  v_cash_release:=v_order.reserved_cash_paise;
  v_close_release:=v_order.reserved_close_quantity;

  if v_cash_release>0 then
    if v_account.reserved_cash_paise<v_cash_release then
      raise exception 'Options LIMIT cash reservation is inconsistent.' using errcode='23514';
    end if;
    update public.paper_accounts
       set reserved_cash_paise=reserved_cash_paise-v_cash_release,
           version=version+1,updated_at=now()
     where user_id=v_user_id;
  end if;

  if v_close_release>0 then
    select * into v_position
      from public.paper_derivative_positions
     where user_id=v_user_id and instrument_key=v_order.instrument_key
     for update;
    if not found or v_position.reserved_quantity<v_close_release then
      raise exception 'Options LIMIT close reservation is inconsistent.' using errcode='23514';
    end if;
    update public.paper_derivative_positions
       set reserved_quantity=reserved_quantity-v_close_release,updated_at=now()
     where user_id=v_user_id and instrument_key=v_order.instrument_key;
  end if;

  update public.paper_option_limit_orders
     set status=p_target_status,reserved_cash_paise=0,reserved_close_quantity=0,
         reservation_released=true,updated_at=now()
   where order_id=p_order_id;

  return jsonb_build_object(
    'order_id',p_order_id,'status',p_target_status,
    'released_cash_paise',v_cash_release,
    'released_close_quantity',v_close_release,
    'idempotent_replay',false,'simulation_only',true
  );
end;
$$;

create or replace function public.cancel_paper_option_limit_order(
  p_user_id uuid,
  p_order_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if p_user_id is null then
    raise exception 'User is required.' using errcode='22023';
  end if;
  select user_id into v_owner
    from public.paper_option_limit_orders
   where order_id=p_order_id;
  if not found or v_owner<>p_user_id then
    raise exception 'Options LIMIT order was not found.' using errcode='P0002';
  end if;
  return public._release_paper_option_limit_order(p_order_id,'CANCELLED');
end;
$$;

create or replace function public.expire_paper_option_limit_order(
  p_order_id text
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._release_paper_option_limit_order(p_order_id,'EXPIRED');
$$;

revoke all on function public.submit_paper_option_limit_order(
  uuid,text,uuid,text,text,text,text,text,text,date,numeric,integer,integer,text,integer,bigint,bigint,timestamptz
) from public,anon,authenticated;
revoke all on function public._release_paper_option_limit_order(text,text)
  from public,anon,authenticated;
revoke all on function public.cancel_paper_option_limit_order(uuid,text)
  from public,anon,authenticated;
revoke all on function public.expire_paper_option_limit_order(text)
  from public,anon,authenticated;

grant execute on function public.submit_paper_option_limit_order(
  uuid,text,uuid,text,text,text,text,text,text,date,numeric,integer,integer,text,integer,bigint,bigint,timestamptz
) to service_role;
grant execute on function public._release_paper_option_limit_order(text,text) to service_role;
grant execute on function public.cancel_paper_option_limit_order(uuid,text) to service_role;
grant execute on function public.expire_paper_option_limit_order(text) to service_role;
