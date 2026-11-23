-- Update the DELETE guard so only orders with live close reservations block a
-- position deletion. The completing fill terminalizes its order in this same
-- transaction before deleting a fully closed position.
create or replace function public._guard_futures_close_reservation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (
      select 1 from public.paper_futures_orders o
       where o.user_id=old.user_id
         and o.instrument_key=old.instrument_key
         and o.order_type='LIMIT'
         and o.status in ('PENDING','PARTIALLY_FILLED')
         and o.reserved_close_quantity>0
    ) then
      raise exception 'Futures position has active close quantity reservations.'
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
revoke all on function public._guard_futures_close_reservation() from public,anon,authenticated;

-- Draft-only atomic Futures LIMIT partial/full fill settlement.
-- Service-role only. No worker or order-route integration is introduced.

-- Persist the exact executable depth snapshot so replay checks and audit records
-- include the quote side/size used to simulate the fill.
alter table public.paper_futures_fills
  add column if not exists bid_price_paise bigint,
  add column if not exists ask_price_paise bigint,
  add column if not exists bid_quantity integer,
  add column if not exists ask_quantity integer;
alter table public.paper_futures_fills
  drop constraint if exists paper_futures_fills_quote_snapshot_check;
alter table public.paper_futures_fills
  add constraint paper_futures_fills_quote_snapshot_check
  check (
    (bid_price_paise is null and ask_price_paise is null
      and bid_quantity is null and ask_quantity is null)
    or
    (bid_price_paise>0 and ask_price_paise>0
      and bid_quantity>0 and ask_quantity>0
      and bid_price_paise<=ask_price_paise)
  );

create or replace function public.execute_paper_futures_limit_fill(
  p_order_id text,
  p_execution_id text,
  p_fill_sequence integer,
  p_fill_quantity integer,
  p_execution_price_paise bigint,
  p_bid_price_paise bigint,
  p_ask_price_paise bigint,
  p_bid_quantity integer,
  p_ask_quantity integer,
  p_charges_paise bigint,
  p_quote_timestamp_ms bigint,
  p_now_ms bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_server_now_ms bigint;
  v_server_now timestamptz;
  v_local_date date;
  v_local_minute integer;
  v_session public.paper_exchange_sessions%rowtype;
  v_account public.paper_accounts%rowtype;
  v_order public.paper_futures_orders%rowtype;
  v_position public.paper_futures_positions%rowtype;
  v_has_position boolean := false;
  v_existing_fill public.paper_futures_fills%rowtype;
  v_next_sequence integer;
  v_new_filled integer;
  v_new_remaining integer;
  v_signed_fill integer;
  v_new_quantity integer;
  v_new_reserved_close integer;
  v_allocated_margin bigint := 0;
  v_margin_release bigint := 0;
  v_realized bigint := 0;
  v_gross_numeric numeric;
  v_gross bigint;
  v_new_average bigint;
  v_new_position_margin bigint;
  v_new_cash bigint;
  v_new_account_margin bigint;
  v_average_fill bigint;
  v_new_status text;
  v_order_updated boolean := false;
  v_fill jsonb;
begin
  if p_order_id is null or p_order_id !~ '^[a-f0-9]{64}$'
     or p_execution_id is null or length(p_execution_id) not between 1 and 160
     or p_fill_sequence is null or p_fill_sequence<1
     or p_fill_quantity is null or p_fill_quantity<1
     or p_execution_price_paise is null or p_execution_price_paise<1
     or p_bid_price_paise is null or p_bid_price_paise<1
     or p_ask_price_paise is null or p_ask_price_paise<1
     or p_bid_quantity is null or p_bid_quantity<1
     or p_ask_quantity is null or p_ask_quantity<1
     or p_bid_price_paise>p_ask_price_paise
     or p_charges_paise is null or p_charges_paise<0
     or p_quote_timestamp_ms is null or p_now_ms is null
     or p_quote_timestamp_ms<0 or p_now_ms<0 then
    raise exception 'Invalid Futures LIMIT fill input.' using errcode='22023';
  end if;

  -- Resolve the owner only to acquire the account lock first. Recheck after locking.
  select user_id into v_user_id
    from public.paper_futures_orders
   where order_id=p_order_id and order_type='LIMIT';
  if not found then
    raise exception 'Futures LIMIT order was not found.' using errcode='P0002';
  end if;

  select * into v_account
    from public.paper_accounts
   where user_id=v_user_id
   for update;
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

  -- An exact execution replay is a no-op. Reusing an execution ID with changed
  -- payload is a hard conflict and cannot mutate account/order/position state.
  select * into v_existing_fill
    from public.paper_futures_fills
   where order_id=p_order_id and execution_id=p_execution_id;
  if found then
    if v_existing_fill.fill_sequence<>p_fill_sequence
       or v_existing_fill.quantity<>p_fill_quantity
       or v_existing_fill.execution_price_paise<>p_execution_price_paise
       or v_existing_fill.bid_price_paise is distinct from p_bid_price_paise
       or v_existing_fill.ask_price_paise is distinct from p_ask_price_paise
       or v_existing_fill.bid_quantity is distinct from p_bid_quantity
       or v_existing_fill.ask_quantity is distinct from p_ask_quantity
       or v_existing_fill.charges_paise<>p_charges_paise
       or v_existing_fill.quote_timestamp_ms<>p_quote_timestamp_ms then
      raise exception 'Futures LIMIT execution ID was replayed with changed fill details.'
        using errcode='23505';
    end if;
    return jsonb_build_object(
      'order_id',p_order_id,'execution_id',p_execution_id,
      'status',v_order.status,'filled_quantity',v_order.filled_quantity,
      'remaining_quantity',v_order.remaining_quantity,
      'idempotent_replay',true,'simulation_only',true
    );
  end if;

  -- A replay is a no-op even after its original quote has aged out. Freshness
  -- and clock checks apply only to a new execution event.
  v_server_now := clock_timestamp();
  v_server_now_ms := floor(extract(epoch from v_server_now)*1000)::bigint;
  if abs(v_server_now_ms-p_now_ms)>2000 then
    raise exception 'Futures LIMIT fill clock is not current.' using errcode='22023';
  end if;
  if not public._paper_quote_age_is_fresh(p_quote_timestamp_ms,v_server_now_ms) then
    raise exception 'A matching fresh Futures provider quote is required.' using errcode='22023';
  end if;

  if v_order.status not in ('PENDING','PARTIALLY_FILLED')
     or v_order.remaining_quantity<1
     or p_fill_quantity>v_order.remaining_quantity then
    raise exception 'Futures LIMIT order is not fillable or fill exceeds its remaining quantity.'
      using errcode='23514';
  end if;
  if v_order.expires_at is null or v_order.expires_at<=v_server_now then
    raise exception 'Expired Futures LIMIT orders cannot be filled.' using errcode='22023';
  end if;
  if v_order.expiry<=(v_server_now at time zone 'Asia/Kolkata')::date then
    if v_server_now>=((v_order.expiry + time '15:30') at time zone 'Asia/Kolkata') then
      raise exception 'Expired Futures contracts cannot be filled.' using errcode='22023';
    end if;
  end if;
  if p_execution_price_paise % v_order.tick_size_paise<>0
     or p_bid_price_paise % v_order.tick_size_paise<>0
     or p_ask_price_paise % v_order.tick_size_paise<>0 then
    raise exception 'Futures LIMIT executable quote prices are off tick.' using errcode='22023';
  end if;
  if (v_order.side='BUY' and p_execution_price_paise>v_order.limit_price_paise)
     or (v_order.side='SELL' and p_execution_price_paise<v_order.limit_price_paise) then
    raise exception 'Futures LIMIT execution price is worse than the limit price.'
      using errcode='23514';
  end if;
  if (v_order.side='BUY' and
        (p_execution_price_paise<>p_ask_price_paise or p_ask_quantity<p_fill_quantity))
     or (v_order.side='SELL' and
        (p_execution_price_paise<>p_bid_price_paise or p_bid_quantity<p_fill_quantity)) then
    raise exception 'Futures LIMIT fill does not match the executable side and displayed depth quantity.'
      using errcode='23514';
  end if;

  -- Fail closed unless the current exchange session has a verified calendar row.
  v_local_date := (v_server_now at time zone 'Asia/Kolkata')::date;
  v_local_minute := extract(hour from (v_server_now at time zone 'Asia/Kolkata'))::integer*60
                  + extract(minute from (v_server_now at time zone 'Asia/Kolkata'))::integer;
  select * into v_session
    from public.paper_exchange_sessions
   where exchange=v_order.exchange and session_date=v_local_date
     and is_trading_day is true
     and session_kind in ('REGULAR','SPECIAL')
     and verified_at<=v_server_now
     and length(btrim(source_reference)) between 1 and 500
     and source_sha256 ~ '^[a-f0-9]{64}$'
     and (
       (v_order.exchange='NSE' and lower(source_reference) ~ '^https://([a-z0-9-]+[.])*nseindia[.]com(/|$)')
       or
       (v_order.exchange='BSE' and lower(source_reference) ~ '^https://([a-z0-9-]+[.])*bseindia[.]com(/|$)')
     );
  if not found or v_local_minute<v_session.open_minute
     or v_local_minute>=v_session.close_minute then
    raise exception 'A verified open NSE/BSE session is required for Futures LIMIT fills.'
      using errcode='22023';
  end if;

  select coalesce(max(fill_sequence),0)+1 into v_next_sequence
    from public.paper_futures_fills where order_id=p_order_id;
  if p_fill_sequence<>v_next_sequence then
    raise exception 'Futures LIMIT fill sequence is not the next expected sequence.'
      using errcode='23514';
  end if;

  v_gross_numeric := p_execution_price_paise::numeric*p_fill_quantity::numeric;
  if v_gross_numeric>9223372036854775807 then
    raise exception 'Futures LIMIT fill turnover exceeds supported bigint range.'
      using errcode='22003';
  end if;
  v_gross := v_gross_numeric::bigint;
  v_new_filled := v_order.filled_quantity+p_fill_quantity;
  v_new_remaining := v_order.remaining_quantity-p_fill_quantity;
  v_signed_fill := case when v_order.side='BUY' then p_fill_quantity else -p_fill_quantity end;
  v_new_status := case when v_new_remaining=0 then 'FILLED' else 'PARTIALLY_FILLED' end;
  v_average_fill := floor(
    (coalesce(v_order.average_fill_price_paise,0)::numeric*v_order.filled_quantity
      + p_execution_price_paise::numeric*p_fill_quantity)
    /v_new_filled
  )::bigint;

  select * into v_position
    from public.paper_futures_positions
   where user_id=v_user_id and instrument_key=v_order.instrument_key
   for update;
  v_has_position := found;

  if v_order.reserved_close_quantity>0 then
    -- Close-only orders can reduce only the originally reserved side and can
    -- never reverse or consume another order's reservation.
    if not v_has_position
       or v_order.reserved_close_quantity<p_fill_quantity
       or v_position.reserved_close_quantity<p_fill_quantity
       or abs(v_position.net_quantity)<p_fill_quantity
       or (v_order.side='SELL' and v_position.net_quantity<=0)
       or (v_order.side='BUY' and v_position.net_quantity>=0) then
      raise exception 'Futures close-only LIMIT fill exceeds its reserved position exposure.'
        using errcode='23514';
    end if;
    if v_position.product<>v_order.product
       or v_position.exchange<>v_order.exchange
       or v_position.segment<>v_order.segment
       or v_position.expiry<>v_order.expiry
       or v_position.lot_size<>v_order.lot_size then
      raise exception 'Futures close-only LIMIT position contract changed.'
        using errcode='23514';
    end if;

    if v_position.net_quantity>0 then
      v_realized := (p_execution_price_paise-v_position.average_price_paise)*p_fill_quantity;
    else
      v_realized := (v_position.average_price_paise-p_execution_price_paise)*p_fill_quantity;
    end if;
    v_margin_release := case
      when p_fill_quantity=abs(v_position.net_quantity) then v_position.reserved_margin_paise
      else floor(v_position.reserved_margin_paise::numeric*p_fill_quantity::numeric
                 /abs(v_position.net_quantity)::numeric)::bigint
    end;
    if v_account.reserved_margin_paise<v_margin_release then
      raise exception 'Futures close fill found inconsistent account margin reservation.'
        using errcode='23514';
    end if;

    v_new_quantity := v_position.net_quantity+v_signed_fill;
    v_new_reserved_close := v_position.reserved_close_quantity-p_fill_quantity;
    v_new_position_margin := v_position.reserved_margin_paise-v_margin_release;
    v_new_account_margin := v_account.reserved_margin_paise-v_margin_release;
    v_new_cash := v_account.cash_paise+v_realized-p_charges_paise;
    if v_new_cash<0 or v_account.reserved_cash_paise+v_new_account_margin>v_new_cash then
      raise exception 'Futures close fill would violate available virtual cash.'
        using errcode='23514';
    end if;

    if v_new_quantity=0 then
      if v_new_reserved_close<>0 then
        raise exception 'Other Futures close reservations remain on a fully closed position.'
          using errcode='23514';
      end if;
      -- Mark the completing order terminal before DELETE so the reservation
      -- guard can distinguish this atomic fill from a MARKET close race.
      update public.paper_futures_orders
         set status=v_new_status,
             filled_quantity=v_new_filled,
             remaining_quantity=v_new_remaining,
             average_fill_price_paise=v_average_fill,
             reserved_open_margin_paise=0,
             reserved_close_quantity=0,
             charges_paise=charges_paise+p_charges_paise,
             realized_pnl_paise=realized_pnl_paise+v_realized,
             reservation_released=true,
             updated_at=now(),filled_at=now()
       where order_id=p_order_id;
      v_order_updated := true;
      delete from public.paper_futures_positions
       where user_id=v_user_id and instrument_key=v_order.instrument_key;
    else
      update public.paper_futures_positions
         set net_quantity=v_new_quantity,
             reserved_margin_paise=v_new_position_margin,
             reserved_close_quantity=v_new_reserved_close,
             realized_pnl_paise=realized_pnl_paise+v_realized,
             updated_at=now()
       where user_id=v_user_id and instrument_key=v_order.instrument_key;
    end if;

    update public.paper_accounts
       set cash_paise=v_new_cash,
           reserved_margin_paise=v_new_account_margin,
           realized_pnl_paise=realized_pnl_paise+v_realized,
           version=version+1,updated_at=now()
     where user_id=v_user_id;
  else
    -- Opening LIMIT fills transfer the allocated margin from the order
    -- reservation to the position without changing account reserved margin.
    if v_order.reserved_open_margin_paise<=0 then
      raise exception 'Opening Futures LIMIT order has no remaining margin reservation.'
        using errcode='23514';
    end if;
    v_allocated_margin := case
      when p_fill_quantity=v_order.remaining_quantity then v_order.reserved_open_margin_paise
      else floor(v_order.reserved_open_margin_paise::numeric*p_fill_quantity::numeric
                 /v_order.remaining_quantity::numeric)::bigint
    end;
    if v_allocated_margin<0 or v_allocated_margin>v_order.reserved_open_margin_paise then
      raise exception 'Futures LIMIT margin allocation is invalid.' using errcode='23514';
    end if;

    if v_has_position then
      if v_position.product<>v_order.product
         or v_position.exchange<>v_order.exchange
         or v_position.segment<>v_order.segment
         or v_position.expiry<>v_order.expiry
         or v_position.lot_size<>v_order.lot_size
         or sign(v_position.net_quantity)<>sign(v_signed_fill) then
        raise exception 'Opening Futures LIMIT fill conflicts with the existing position.'
          using errcode='23514';
      end if;
      v_new_quantity := v_position.net_quantity+v_signed_fill;
      v_new_average := floor(
        (abs(v_position.net_quantity)::numeric*v_position.average_price_paise
          + p_fill_quantity::numeric*p_execution_price_paise)
        /abs(v_new_quantity)::numeric
      )::bigint;
      v_new_position_margin := v_position.reserved_margin_paise+v_allocated_margin;
      update public.paper_futures_positions
         set net_quantity=v_new_quantity,
             average_price_paise=v_new_average,
             reserved_margin_paise=v_new_position_margin,
             updated_at=now()
       where user_id=v_user_id and instrument_key=v_order.instrument_key;
    else
      insert into public.paper_futures_positions(
        user_id,instrument_key,trading_symbol,exchange,segment,expiry,product,
        lot_size,tick_size_paise,net_quantity,average_price_paise,
        reserved_margin_paise,realized_pnl_paise,reserved_close_quantity,updated_at
      ) values (
        v_user_id,v_order.instrument_key,v_order.trading_symbol,v_order.exchange,
        v_order.segment,v_order.expiry,v_order.product,v_order.lot_size,
        v_order.tick_size_paise,v_signed_fill,p_execution_price_paise,
        v_allocated_margin,0,0,now()
      );
    end if;

    v_new_cash := v_account.cash_paise-p_charges_paise;
    if v_new_cash<0
       or v_account.reserved_cash_paise+v_account.reserved_margin_paise>v_new_cash then
      raise exception 'Futures opening fill charges exceed available virtual cash.'
        using errcode='23514';
    end if;
    update public.paper_accounts
       set cash_paise=v_new_cash,version=version+1,updated_at=now()
     where user_id=v_user_id;
  end if;

  if not v_order_updated then
    update public.paper_futures_orders
       set status=v_new_status,
         filled_quantity=v_new_filled,
         remaining_quantity=v_new_remaining,
         average_fill_price_paise=v_average_fill,
         reserved_open_margin_paise=reserved_open_margin_paise-v_allocated_margin,
         reserved_close_quantity=reserved_close_quantity-
           case when v_order.reserved_close_quantity>0 then p_fill_quantity else 0 end,
         charges_paise=charges_paise+p_charges_paise,
         realized_pnl_paise=realized_pnl_paise+v_realized,
         reservation_released=(v_new_remaining=0),
         updated_at=now(),
           filled_at=case when v_new_remaining=0 then now() else filled_at end
     where order_id=p_order_id;
  end if;

  insert into public.paper_futures_fills(
    order_id,user_id,execution_id,fill_sequence,quantity,
    execution_price_paise,bid_price_paise,ask_price_paise,bid_quantity,ask_quantity,
    gross_paise,allocated_margin_paise,charges_paise,realized_pnl_paise,
    quote_timestamp_ms,simulation_only
  ) values (
    p_order_id,v_user_id,p_execution_id,p_fill_sequence,p_fill_quantity,
    p_execution_price_paise,p_bid_price_paise,p_ask_price_paise,p_bid_quantity,p_ask_quantity,
    v_gross,
    case when v_order.reserved_close_quantity>0 then v_margin_release else v_allocated_margin end,
    p_charges_paise,v_realized,p_quote_timestamp_ms,true
  );

  select to_jsonb(f) into v_fill
    from public.paper_futures_fills f
   where f.order_id=p_order_id and f.execution_id=p_execution_id;
  return jsonb_build_object(
    'order_id',p_order_id,'status',v_new_status,
    'filled_quantity',v_new_filled,'remaining_quantity',v_new_remaining,
    'average_fill_price_paise',v_average_fill,
    'allocated_margin_paise',case when v_order.reserved_close_quantity>0 then v_margin_release else v_allocated_margin end,
    'realized_pnl_paise',v_realized,'fill',v_fill,
    'idempotent_replay',false,'simulation_only',true
  );
end;
$$;

revoke all on function public.execute_paper_futures_limit_fill(
  text,text,integer,integer,bigint,bigint,bigint,integer,integer,bigint,bigint,bigint
) from public,anon,authenticated;
grant execute on function public.execute_paper_futures_limit_fill(
  text,text,integer,integer,bigint,bigint,bigint,integer,integer,bigint,bigint,bigint
) to service_role;

comment on function public.execute_paper_futures_limit_fill(text,text,integer,integer,bigint,bigint,bigint,integer,integer,bigint,bigint,bigint) is
  'Atomic simulation-only Futures LIMIT fill. Validates session, quote freshness, limit price, order and reservations; execution events are idempotent.';
