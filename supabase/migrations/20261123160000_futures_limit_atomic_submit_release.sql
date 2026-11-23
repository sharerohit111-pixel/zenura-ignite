-- Draft-only atomic Futures LIMIT submit/cancel/expiry foundation.
-- No fill RPC, worker, route wiring, or feature enablement is introduced here.
-- All writes are simulation-only and service-role-only.

-- Preserve the tick-size snapshot used to validate every later partial fill.
alter table public.paper_futures_orders
  add column if not exists tick_size_paise integer;
alter table public.paper_futures_orders
  drop constraint if exists paper_futures_order_tick_size_check;
alter table public.paper_futures_orders
  add constraint paper_futures_order_tick_size_check
  check (tick_size_paise is null or tick_size_paise between 1 and 1000000);
alter table public.paper_futures_orders
  drop constraint if exists paper_futures_limit_requires_tick_size;
alter table public.paper_futures_orders
  add constraint paper_futures_limit_requires_tick_size
  check (order_type <> 'LIMIT' or tick_size_paise is not null);


-- Prevent legacy Futures MARKET orders from consuming quantity reserved by
-- outstanding close-only LIMIT orders. The row CHECK also guarantees that the
-- remaining reservation never exceeds the remaining signed position.
create or replace function public._guard_futures_close_reservation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.reserved_close_quantity > 0 then
      raise exception 'Futures position has close quantity reserved by pending LIMIT orders.'
        using errcode='23514';
    end if;
    return old;
  end if;

  if old.reserved_close_quantity > 0
     and new.net_quantity <> 0
     and sign(new.net_quantity) <> sign(old.net_quantity) then
    raise exception 'Futures position cannot reverse while close quantity is reserved.'
      using errcode='23514';
  end if;

  if new.net_quantity = 0 and new.reserved_close_quantity <> 0 then
    raise exception 'All close reservations must be released before a Futures position is closed.'
      using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists paper_futures_close_reservation_guard
  on public.paper_futures_positions;
create trigger paper_futures_close_reservation_guard
before update or delete on public.paper_futures_positions
for each row execute function public._guard_futures_close_reservation();

revoke all on function public._guard_futures_close_reservation() from public,anon,authenticated;

create or replace function public.submit_paper_futures_limit_order(
  p_user_id uuid,
  p_order_id text,
  p_idempotency_key uuid,
  p_request_fingerprint text,
  p_instrument_key text,
  p_trading_symbol text,
  p_exchange text,
  p_segment text,
  p_expiry date,
  p_lot_size integer,
  p_tick_size_paise integer,
  p_side text,
  p_product text,
  p_quantity integer,
  p_limit_price_paise bigint,
  p_open_margin_paise bigint,
  p_margin_quote_timestamp_ms bigint,
  p_now_ms bigint,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.paper_accounts%rowtype;
  v_existing public.paper_futures_orders%rowtype;
  v_position public.paper_futures_positions%rowtype;
  v_has_position boolean := false;
  v_close_only boolean := false;
  v_server_now timestamptz := clock_timestamp();
  v_server_now_ms bigint;
  v_submit_local_date date;
  v_submit_local_minute integer;
  v_submit_session public.paper_exchange_sessions%rowtype;
  v_submit_session_close timestamptz;
  v_available_quantity integer;
begin
  if p_user_id is null
     or p_order_id is null or p_order_id !~ '^[a-f0-9]{64}$'
     or p_idempotency_key is null
     or p_request_fingerprint is null or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_instrument_key is null or length(p_instrument_key) not between 1 and 100
     or p_trading_symbol is null or length(p_trading_symbol) not between 1 and 100
     or p_exchange is null or p_exchange not in ('NSE','BSE')
     or p_segment is null or p_segment not in ('NSE_FO','BSE_FO')
     or (p_exchange='NSE' and p_segment<>'NSE_FO')
     or (p_exchange='BSE' and p_segment<>'BSE_FO')
     or p_expiry is null
     or p_lot_size is null or p_lot_size not between 1 and 1000000
     or p_tick_size_paise is null or p_tick_size_paise not between 1 and 1000000
     or p_side is null or p_side not in ('BUY','SELL')
     or p_product is null or p_product not in ('INTRADAY','DELIVERY')
     or p_quantity is null or p_quantity not between 1 and 1000000
     or p_quantity % p_lot_size <> 0
     or p_limit_price_paise is null or p_limit_price_paise <= 0
     or p_limit_price_paise % p_tick_size_paise <> 0
     or p_open_margin_paise is null or p_open_margin_paise < 0
     or p_now_ms is null or p_now_ms<0
     or p_expires_at is null
  then
    raise exception 'Invalid or unsupported Futures LIMIT order input.'
      using errcode='22023';
  end if;

  -- Global write order: account -> order -> position. This serializes shared cash.
  select * into v_account
    from public.paper_accounts
   where user_id=p_user_id
   for update;
  if not found then
    raise exception 'Paper Trading account is not initialized.' using errcode='P0002';
  end if;

  select * into v_existing
    from public.paper_futures_orders
   where user_id=p_user_id and idempotency_key=p_idempotency_key
   for update;
  if found then
    if v_existing.order_id<>p_order_id
       or v_existing.request_fingerprint<>p_request_fingerprint then
      raise exception 'Futures LIMIT idempotency key was reused with different order details.'
        using errcode='23505';
    end if;
    return jsonb_build_object(
      'order_id',v_existing.order_id,'status',v_existing.status,
      'filled_quantity',v_existing.filled_quantity,
      'remaining_quantity',v_existing.remaining_quantity,
      'reserved_open_margin_paise',v_existing.reserved_open_margin_paise,
      'reserved_close_quantity',v_existing.reserved_close_quantity,
      'idempotent_replay',true,'simulation_only',true
    );
  end if;

  select * into v_position
    from public.paper_futures_positions
   where user_id=p_user_id and instrument_key=p_instrument_key
   for update;
  v_has_position := found;

  if v_has_position then
    if v_position.product<>p_product
       or v_position.exchange<>p_exchange
       or v_position.segment<>p_segment
       or v_position.expiry<>p_expiry
       or v_position.lot_size<>p_lot_size
       or v_position.tick_size_paise<>p_tick_size_paise then
      raise exception 'Futures LIMIT contract does not match the existing position.'
        using errcode='23514';
    end if;
    v_close_only := (v_position.net_quantity>0 and p_side='SELL')
                 or (v_position.net_quantity<0 and p_side='BUY');
  end if;

  v_server_now:=clock_timestamp();
  v_server_now_ms:=floor(extract(epoch from v_server_now)*1000)::bigint;
  v_submit_local_date:=(v_server_now at time zone 'Asia/Kolkata')::date;
  v_submit_local_minute:=extract(hour from (v_server_now at time zone 'Asia/Kolkata'))::integer*60
    +extract(minute from (v_server_now at time zone 'Asia/Kolkata'))::integer;
  select * into v_submit_session
    from public.paper_exchange_sessions
   where exchange=p_exchange and session_date=v_submit_local_date
     and is_trading_day is true and session_kind in ('REGULAR','SPECIAL')
     and verified_at<=v_server_now
     and length(btrim(source_reference)) between 1 and 500
     and source_sha256 ~ '^[a-f0-9]{64}$'
     and (
       (p_exchange='NSE' and lower(source_reference) ~ '^https://([a-z0-9-]+[.])*nseindia[.]com(/|$)')
       or
       (p_exchange='BSE' and lower(source_reference) ~ '^https://([a-z0-9-]+[.])*bseindia[.]com(/|$)')
     );
  if not found
     or abs(v_server_now_ms-p_now_ms)>2000
     or p_expiry<v_submit_local_date
     or p_expires_at<=v_server_now
     or p_expires_at>((p_expiry + time '15:30') at time zone 'Asia/Kolkata')
     or v_submit_local_minute<v_submit_session.open_minute
     or v_submit_local_minute>=v_submit_session.close_minute then
    raise exception 'A fresh clock and verified open exchange session are required for Futures LIMIT submit.'
      using errcode='22023';
  end if;
  v_submit_session_close:=(v_submit_local_date::timestamp
    +make_interval(mins=>v_submit_session.close_minute)) at time zone 'Asia/Kolkata';
  if p_expires_at>v_submit_session_close then
    raise exception 'Futures LIMIT expiry cannot exceed the verified session close.'
      using errcode='22023';
  end if;

  if v_close_only then
    v_available_quantity := abs(v_position.net_quantity)-v_position.reserved_close_quantity;
    if p_quantity>v_available_quantity then
      raise exception 'Futures close-only LIMIT quantity exceeds unreserved position quantity.'
        using errcode='23514';
    end if;
    if p_open_margin_paise<>0 then
      raise exception 'Close-only Futures LIMIT orders must not reserve opening margin.'
        using errcode='22023';
    end if;
    update public.paper_futures_positions
       set reserved_close_quantity=reserved_close_quantity+p_quantity,
           updated_at=now()
     where user_id=p_user_id and instrument_key=p_instrument_key;
  else
    if p_open_margin_paise<=0 then
      raise exception 'A positive trusted provider margin reservation is required for opening Futures LIMIT orders.'
        using errcode='22023';
    end if;
    if not public._paper_quote_age_is_fresh(p_margin_quote_timestamp_ms,v_server_now_ms) then
      raise exception 'A fresh trusted provider margin snapshot is required for opening Futures LIMIT orders.'
        using errcode='22023';
    end if;
    if p_open_margin_paise > v_account.cash_paise
       or v_account.reserved_cash_paise >
          v_account.cash_paise-p_open_margin_paise
       or v_account.reserved_margin_paise >
          v_account.cash_paise-v_account.reserved_cash_paise-p_open_margin_paise then
      raise exception 'Insufficient available virtual cash for Futures LIMIT margin.'
        using errcode='23514';
    end if;
    update public.paper_accounts
       set reserved_margin_paise=reserved_margin_paise+p_open_margin_paise,
           version=version+1,updated_at=now()
     where user_id=p_user_id;
  end if;

  insert into public.paper_futures_orders(
    order_id,user_id,idempotency_key,request_fingerprint,instrument_key,
    trading_symbol,exchange,segment,expiry,lot_size,side,product,order_type,
    status,quantity,limit_price_paise,tick_size_paise,margin_reserved_paise,charges_paise,
    realized_pnl_paise,reservation_released,simulation_only,created_at,updated_at,
    filled_quantity,remaining_quantity,average_fill_price_paise,
    reserved_open_margin_paise,reserved_close_quantity,expires_at
  ) values (
    p_order_id,p_user_id,p_idempotency_key,p_request_fingerprint,p_instrument_key,
    p_trading_symbol,p_exchange,p_segment,p_expiry,p_lot_size,p_side,p_product,'LIMIT',
    'PENDING',p_quantity,p_limit_price_paise,p_tick_size_paise,p_open_margin_paise,0,
    0,false,true,now(),now(),0,p_quantity,null,
    case when v_close_only then 0 else p_open_margin_paise end,
    case when v_close_only then p_quantity else 0 end,p_expires_at
  );

  return jsonb_build_object(
    'order_id',p_order_id,'status','PENDING','filled_quantity',0,
    'remaining_quantity',p_quantity,
    'reserved_open_margin_paise',case when v_close_only then 0 else p_open_margin_paise end,
    'reserved_close_quantity',case when v_close_only then p_quantity else 0 end,
    'idempotent_replay',false,'simulation_only',true
  );
end;
$$;

-- Shared atomic release primitive for user cancellation and worker expiry.
create or replace function public._release_paper_futures_limit_order(
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
  v_order public.paper_futures_orders%rowtype;
  v_position public.paper_futures_positions%rowtype;
  v_open_release bigint;
  v_close_release integer;
  v_expiry_now timestamptz;
  v_expiry_local_date date;
  v_expiry_local_minute integer;
  v_expiry_session public.paper_exchange_sessions%rowtype;
begin
  if p_order_id is null or p_order_id !~ '^[a-f0-9]{64}$'
     or p_target_status is null
     or p_target_status not in ('CANCELLED','EXPIRED') then
    raise exception 'Invalid Futures LIMIT release request.' using errcode='22023';
  end if;

  -- Read owner only to acquire the account lock first; ownership is rechecked
  -- after the order row is locked.
  select user_id into v_user_id
    from public.paper_futures_orders
   where order_id=p_order_id and order_type='LIMIT';
  if not found then
    raise exception 'Futures LIMIT order was not found.' using errcode='P0002';
  end if;

  select * into v_account
    from public.paper_accounts where user_id=v_user_id for update;
  if not found then
    raise exception 'Paper Trading account is not initialized.' using errcode='P0002';
  end if;

  select * into v_order
    from public.paper_futures_orders
   where order_id=p_order_id and user_id=v_user_id
   for update;
  if not found then
    raise exception 'Futures LIMIT order ownership changed.' using errcode='P0002';
  end if;

  if v_order.status in ('CANCELLED','EXPIRED','FILLED','REJECTED') then
    return jsonb_build_object(
      'order_id',v_order.order_id,'status',v_order.status,
      'released_open_margin_paise',0,'released_close_quantity',0,
      'idempotent_replay',true,'simulation_only',true
    );
  end if;
  if p_target_status='EXPIRED' then
    v_expiry_now:=clock_timestamp();
    v_expiry_local_date:=(v_expiry_now at time zone 'Asia/Kolkata')::date;
    v_expiry_local_minute:=extract(hour from (v_expiry_now at time zone 'Asia/Kolkata'))::integer*60
      +extract(minute from (v_expiry_now at time zone 'Asia/Kolkata'))::integer;
    if v_order.expires_at>v_expiry_now
       and v_expiry_now<((v_order.expiry + time '15:30') at time zone 'Asia/Kolkata') then
      select * into v_expiry_session
        from public.paper_exchange_sessions
       where exchange=v_order.exchange and session_date=v_expiry_local_date
         and is_trading_day is true and session_kind in ('REGULAR','SPECIAL')
         and verified_at<=v_expiry_now
         and length(btrim(source_reference)) between 1 and 500
         and source_sha256 ~ '^[a-f0-9]{64}$'
         and (
           (v_order.exchange='NSE' and lower(source_reference) ~ '^https://([a-z0-9-]+[.])*nseindia[.]com(/|$)')
           or
           (v_order.exchange='BSE' and lower(source_reference) ~ '^https://([a-z0-9-]+[.])*bseindia[.]com(/|$)')
         );
      if found and v_expiry_local_minute>=v_expiry_session.open_minute
         and v_expiry_local_minute<v_expiry_session.close_minute then
        raise exception 'Futures LIMIT order is still inside a verified exchange session.'
          using errcode='22023';
      end if;
    end if;
  end if;

  v_open_release := v_order.reserved_open_margin_paise;
  v_close_release := v_order.reserved_close_quantity;

  if v_open_release>0 then
    if v_account.reserved_margin_paise<v_open_release then
      raise exception 'Futures LIMIT opening-margin reservation is inconsistent.'
        using errcode='23514';
    end if;
    update public.paper_accounts
       set reserved_margin_paise=reserved_margin_paise-v_open_release,
           version=version+1,updated_at=now()
     where user_id=v_user_id;
  end if;

  if v_close_release>0 then
    select * into v_position
      from public.paper_futures_positions
     where user_id=v_user_id and instrument_key=v_order.instrument_key
     for update;
    if not found or v_position.reserved_close_quantity<v_close_release then
      raise exception 'Futures LIMIT close reservation is inconsistent.'
        using errcode='23514';
    end if;
    update public.paper_futures_positions
       set reserved_close_quantity=reserved_close_quantity-v_close_release,
           updated_at=now()
     where user_id=v_user_id and instrument_key=v_order.instrument_key;
  end if;

  update public.paper_futures_orders
     set status=p_target_status,
         reserved_open_margin_paise=0,
         reserved_close_quantity=0,
         reservation_released=true,
         updated_at=now()
   where order_id=p_order_id;

  return jsonb_build_object(
    'order_id',p_order_id,'status',p_target_status,
    'released_open_margin_paise',v_open_release,
    'released_close_quantity',v_close_release,
    'idempotent_replay',false,'simulation_only',true
  );
end;
$$;

create or replace function public.cancel_paper_futures_limit_order(
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
    from public.paper_futures_orders
   where order_id=p_order_id and order_type='LIMIT';
  if not found or v_owner<>p_user_id then
    raise exception 'Futures LIMIT order was not found.' using errcode='P0002';
  end if;
  return public._release_paper_futures_limit_order(p_order_id,'CANCELLED');
end;
$$;

create or replace function public.expire_paper_futures_limit_order(
  p_order_id text
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._release_paper_futures_limit_order(p_order_id,'EXPIRED');
$$;

revoke all on function public.submit_paper_futures_limit_order(
  uuid,text,uuid,text,text,text,text,text,date,integer,integer,text,text,integer,bigint,bigint,bigint,bigint,timestamptz
) from public,anon,authenticated;
revoke all on function public._release_paper_futures_limit_order(text,text)
  from public,anon,authenticated;
revoke all on function public.cancel_paper_futures_limit_order(uuid,text)
  from public,anon,authenticated;
revoke all on function public.expire_paper_futures_limit_order(text)
  from public,anon,authenticated;
grant execute on function public.submit_paper_futures_limit_order(
  uuid,text,uuid,text,text,text,text,text,date,integer,integer,text,text,integer,bigint,bigint,bigint,bigint,timestamptz
) to service_role;
grant execute on function public.cancel_paper_futures_limit_order(uuid,text)
  to service_role;
grant execute on function public.expire_paper_futures_limit_order(text)
  to service_role;

comment on function public.submit_paper_futures_limit_order(uuid,text,uuid,text,text,text,text,text,date,integer,integer,text,text,integer,bigint,bigint,bigint,bigint,timestamptz) is
  'Atomic simulation-only Futures LIMIT submission. Reserves opening margin or close quantity; does not execute fills.';
