-- Draft-only, transactional MARKET futures execution.
-- p_open_margin_paise is the trusted server's current provider margin requirement
-- for the newly opened/increased quantity, not a browser-supplied balance.
create or replace function public.execute_paper_futures_market_order(
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
  p_execution_price_paise bigint,
  p_open_margin_paise bigint,
  p_charges_paise bigint,
  p_quote_timestamp_ms bigint,
  p_now_ms bigint
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
  v_server_now_ms bigint;
  v_quote_age bigint;
  v_expiry_cutoff_ms numeric;
  v_old_qty bigint := 0;
  v_new_qty bigint;
  v_old_abs bigint := 0;
  v_close_qty bigint := 0;
  v_open_qty bigint := 0;
  v_old_margin bigint := 0;
  v_margin_release bigint := 0;
  v_margin_add bigint := 0;
  v_new_margin bigint := 0;
  v_old_avg bigint := 0;
  v_new_avg bigint := 0;
  v_realized bigint := 0;
  v_new_cash bigint;
  v_new_reserved_margin bigint;
  v_order jsonb;
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
     or p_expiry is null or p_expiry<current_date
     or p_lot_size is null or p_lot_size not between 1 and 1000000
     or p_tick_size_paise is null or p_tick_size_paise not between 1 and 1000000
     or p_side is null or p_side not in ('BUY','SELL')
     or p_product is null or p_product not in ('INTRADAY','DELIVERY')
     or p_quantity is null or p_quantity not between 1 and 1000000
     or p_quantity % p_lot_size <> 0
     or p_execution_price_paise is null or p_execution_price_paise<=0
     or p_execution_price_paise % p_tick_size_paise <> 0
     or p_open_margin_paise is null or p_open_margin_paise<0
     or p_charges_paise is null or p_charges_paise<0
     or p_quote_timestamp_ms is null or p_now_ms is null
     or p_quote_timestamp_ms<0 or p_now_ms<0
  then
    raise exception 'Invalid or unsupported futures contract/order input.' using errcode='22023';
  end if;

  v_server_now_ms := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if abs(v_server_now_ms-p_now_ms)>2000 then
    raise exception 'Futures quote clock is not current.' using errcode='22023';
  end if;
  v_quote_age := v_server_now_ms-p_quote_timestamp_ms;
  if not public._paper_quote_age_is_fresh(p_quote_timestamp_ms,v_server_now_ms) then
    raise exception 'A matching fresh provider quote is required.' using errcode='22023';
  end if;
  v_expiry_cutoff_ms :=
    extract(epoch from ((p_expiry + time '15:30') at time zone 'Asia/Kolkata'))*1000;
  if v_server_now_ms>v_expiry_cutoff_ms then
    raise exception 'Expired futures contracts cannot be traded.' using errcode='22023';
  end if;

  -- Account-first lock serializes all order types and all shared cash/margin changes.
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
      raise exception 'Futures idempotency key was reused with different order details.' using errcode='23505';
    end if;
    return jsonb_build_object(
      'status',v_existing.status,'order_id',v_existing.order_id,
      'cash_paise',v_account.cash_paise,'reserved_margin_paise',v_account.reserved_margin_paise,
      'realized_pnl_paise',v_existing.realized_pnl_paise,'idempotent_replay',true,
      'simulation_only',true
    );
  end if;

  select * into v_position
    from public.paper_futures_positions
   where user_id=p_user_id and instrument_key=p_instrument_key
   for update;
  v_has_position := found;
  if v_has_position then
    if v_position.product<>p_product then
      raise exception 'An open futures position cannot switch between Intraday and Delivery products.' using errcode='23514';
    end if;
    v_old_qty := v_position.net_quantity;
    v_old_abs := abs(v_old_qty);
    v_old_avg := v_position.average_price_paise;
    v_old_margin := v_position.reserved_margin_paise;
  end if;

  v_new_qty := v_old_qty + case when p_side='BUY' then p_quantity else -p_quantity end;
  if v_old_qty=0 or (v_old_qty>0 and p_side='BUY') or (v_old_qty<0 and p_side='SELL') then
    -- Flat or same-direction add: margin is reserved for the incremental open quantity.
    v_open_qty := p_quantity;
    v_margin_add := p_open_margin_paise;
    if v_open_qty>0 and v_margin_add<=0 then
      raise exception 'A positive provider margin requirement is required for an opening futures position.' using errcode='22023';
    end if;
    if v_old_abs=0 then
      v_new_avg := p_execution_price_paise;
    else
      v_new_avg := floor(
        (v_old_abs::numeric*v_old_avg + p_quantity::numeric*p_execution_price_paise)
        / abs(v_new_qty)::numeric
      )::bigint;
    end if;
    v_new_margin := v_old_margin+v_margin_add;
  else
    -- Opposite-side trade first closes existing exposure; any remainder opens the reverse side.
    v_close_qty := least(v_old_abs,p_quantity);
    if v_old_qty>0 then
      v_realized := (p_execution_price_paise-v_old_avg)*v_close_qty;
    else
      v_realized := (v_old_avg-p_execution_price_paise)*v_close_qty;
    end if;
    v_margin_release := case
      when v_close_qty=v_old_abs then v_old_margin
      else floor(v_old_margin::numeric*v_close_qty::numeric/v_old_abs::numeric)::bigint
    end;
    v_open_qty := greatest(0,p_quantity-v_close_qty);
    if v_open_qty>0 then
      if p_open_margin_paise<=0 then
        raise exception 'A positive provider margin requirement is required for the reversed futures position.' using errcode='22023';
      end if;
      v_margin_add := p_open_margin_paise;
      v_new_avg := p_execution_price_paise;
    else
      v_new_avg := v_old_avg;
    end if;
    v_new_margin := v_old_margin-v_margin_release+v_margin_add;
  end if;

  if v_new_margin<0 or v_account.reserved_margin_paise<v_margin_release then
    raise exception 'Futures margin reservation state is invalid.' using errcode='23514';
  end if;
  v_new_reserved_margin := v_account.reserved_margin_paise-v_margin_release+v_margin_add;
  v_new_cash := v_account.cash_paise+v_realized-p_charges_paise;
  if v_new_cash<0 or v_account.reserved_cash_paise+v_new_reserved_margin>v_new_cash then
    raise exception 'Insufficient available virtual cash for futures margin and charges.' using errcode='23514';
  end if;

  if v_new_qty=0 then
    delete from public.paper_futures_positions
     where user_id=p_user_id and instrument_key=p_instrument_key;
  else
    insert into public.paper_futures_positions(
      user_id,instrument_key,trading_symbol,exchange,segment,expiry,product,
      lot_size,tick_size_paise,net_quantity,average_price_paise,
      reserved_margin_paise,realized_pnl_paise,updated_at
    ) values (
      p_user_id,p_instrument_key,p_trading_symbol,p_exchange,p_segment,p_expiry,p_product,
      p_lot_size,p_tick_size_paise,v_new_qty,v_new_avg,
      v_new_margin,v_realized,now()
    )
    on conflict(user_id,instrument_key) do update set
      trading_symbol=excluded.trading_symbol,
      exchange=excluded.exchange,
      segment=excluded.segment,
      expiry=excluded.expiry,
      product=excluded.product,
      lot_size=excluded.lot_size,
      tick_size_paise=excluded.tick_size_paise,
      net_quantity=excluded.net_quantity,
      average_price_paise=excluded.average_price_paise,
      reserved_margin_paise=excluded.reserved_margin_paise,
      realized_pnl_paise=public.paper_futures_positions.realized_pnl_paise+excluded.realized_pnl_paise,
      updated_at=now();
  end if;

  update public.paper_accounts
     set cash_paise=v_new_cash,
         reserved_margin_paise=v_new_reserved_margin,
         realized_pnl_paise=realized_pnl_paise+v_realized,
         version=version+1,
         updated_at=now()
   where user_id=p_user_id;

  insert into public.paper_futures_orders(
    order_id,user_id,idempotency_key,request_fingerprint,instrument_key,
    trading_symbol,exchange,segment,expiry,lot_size,side,product,order_type,
    status,quantity,execution_price_paise,margin_reserved_paise,charges_paise,
    realized_pnl_paise,quote_timestamp_ms,quote_age_ms,reservation_released,
    simulation_only,created_at,updated_at,filled_at
  ) values (
    p_order_id,p_user_id,p_idempotency_key,p_request_fingerprint,p_instrument_key,
    p_trading_symbol,p_exchange,p_segment,p_expiry,p_lot_size,p_side,p_product,'MARKET',
    'FILLED',p_quantity,p_execution_price_paise,v_margin_add,p_charges_paise,
    v_realized,p_quote_timestamp_ms,v_quote_age,true,true,now(),now(),now()
  );

  select to_jsonb(o) into v_order
    from public.paper_futures_orders o
   where o.order_id=p_order_id;
  return jsonb_build_object(
    'order',v_order,'cash_paise',v_new_cash,
    'reserved_margin_paise',v_new_reserved_margin,
    'order_realized_pnl_paise',v_realized,
    'idempotent_replay',false,'simulation_only',true
  );
end;
$$;

revoke all on function public.execute_paper_futures_market_order(
  uuid,text,uuid,text,text,text,text,text,date,integer,integer,text,text,integer,bigint,bigint,bigint,bigint,bigint
) from public,anon,authenticated;
grant execute on function public.execute_paper_futures_market_order(
  uuid,text,uuid,text,text,text,text,text,date,integer,integer,text,text,integer,bigint,bigint,bigint,bigint,bigint
) to service_role;
