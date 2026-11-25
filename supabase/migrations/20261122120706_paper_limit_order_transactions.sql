-- DRAFT ONLY — pending LIMIT lifecycle. Do not apply before staging review and explicit approval.
-- Delivery-only equity LIMIT orders, matching the inspected Firebase worker contract.
-- All cash/share reservations and order transitions are atomic under the account row lock.
-- The trusted backend supplies authenticated user identity and freshly validated Upstox quotes.

create or replace function public.submit_paper_limit_order(
  p_user_id uuid,
  p_order_id text,
  p_idempotency_key uuid,
  p_request_fingerprint text,
  p_instrument_key text,
  p_trading_symbol text,
  p_exchange text,
  p_side text,
  p_quantity integer,
  p_limit_price_paise bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.paper_accounts%rowtype;
  v_position public.paper_equity_positions%rowtype;
  v_existing public.paper_orders%rowtype;
  v_reserve bigint;
  v_available bigint;
  v_new_reserved integer;
begin
  if p_user_id is null or p_order_id is null or p_order_id !~ '^[a-f0-9]{64}$'
     or p_idempotency_key is null or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_instrument_key is null or length(p_instrument_key) not between 1 and 100
     or p_side is null or p_side not in ('BUY','SELL')
     or p_quantity is null or p_quantity not between 1 and 1000000
     or p_limit_price_paise is null or p_limit_price_paise <= 0 then
    raise exception using errcode='22023', message='Invalid paper LIMIT order request';
  end if;

  -- LIMIT is deliberately Delivery-only, matching the existing API/worker.
  select * into v_account from public.paper_accounts
   where user_id=p_user_id for update;
  if not found then
    raise exception using errcode='P0002', message='Paper account is not initialized';
  end if;
  if v_account.cash_paise < 0 or v_account.reserved_cash_paise < 0
     or v_account.reserved_margin_paise < 0
     or v_account.reserved_cash_paise + v_account.reserved_margin_paise > v_account.cash_paise
     or v_account.version < 1 then
    raise exception using errcode='23514', message='Invalid account reservations or balance';
  end if;

  select * into v_existing from public.paper_orders
   where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> p_request_fingerprint then
      raise exception using errcode='23505', message='Idempotency key reused for a different order';
    end if;
    return jsonb_build_object('order_id',v_existing.order_id,'status',v_existing.status,
      'reserved_cash_paise',v_existing.reserved_cash_paise,
      'reserved_quantity',v_existing.reserved_quantity,'idempotent_replay',true,
      'simulation_only',true);
  end if;

  if exists(select 1 from public.paper_orders where order_id=p_order_id) then
    raise exception using errcode='23505', message='Order ID already exists';
  end if;

  v_reserve := p_limit_price_paise::bigint * p_quantity::bigint;
  if v_reserve <= 0 or v_reserve > 9007199254740991 then
    raise exception using errcode='22003', message='LIMIT reservation exceeds supported limits';
  end if;

  select * into v_position from public.paper_equity_positions
   where user_id=p_user_id and product='DELIVERY' and instrument_key=p_instrument_key
   for update;

  if p_side='BUY' then
    v_available := v_account.cash_paise - v_account.reserved_cash_paise - v_account.reserved_margin_paise;
    if v_available < v_reserve then
      raise exception using errcode='23514', message='Insufficient unreserved virtual cash for LIMIT BUY';
    end if;
    insert into public.paper_orders(
      order_id,user_id,idempotency_key,request_fingerprint,instrument_key,
      trading_symbol,exchange,side,product,order_type,status,quantity,
      limit_price_paise,reserved_cash_paise,reserved_quantity,
      reservation_released,simulation_only,created_at,updated_at
    ) values (
      p_order_id,p_user_id,p_idempotency_key,p_request_fingerprint,p_instrument_key,
      p_trading_symbol,p_exchange,'BUY','DELIVERY','LIMIT','PENDING',p_quantity,
      p_limit_price_paise,v_reserve,0,false,true,now(),now()
    );
    update public.paper_accounts set reserved_cash_paise=reserved_cash_paise+v_reserve,
      version=version+1,updated_at=now() where user_id=p_user_id;
  else
    if not found then
      raise exception using errcode='23514', message='No Delivery position available to reserve';
    end if;
    if p_quantity > v_position.quantity-v_position.reserved_quantity then
      raise exception using errcode='23514', message='Insufficient unreserved Delivery shares';
    end if;
    v_new_reserved := v_position.reserved_quantity+p_quantity;
    update public.paper_equity_positions set reserved_quantity=v_new_reserved,updated_at=now()
     where user_id=p_user_id and product='DELIVERY' and instrument_key=p_instrument_key;
    insert into public.paper_orders(
      order_id,user_id,idempotency_key,request_fingerprint,instrument_key,
      trading_symbol,exchange,side,product,order_type,status,quantity,
      limit_price_paise,reserved_cash_paise,reserved_quantity,
      reservation_released,simulation_only,created_at,updated_at
    ) values (
      p_order_id,p_user_id,p_idempotency_key,p_request_fingerprint,p_instrument_key,
      p_trading_symbol,p_exchange,'SELL','DELIVERY','LIMIT','PENDING',p_quantity,
      p_limit_price_paise,0,p_quantity,false,true,now(),now()
    );
    update public.paper_accounts set version=version+1,updated_at=now()
     where user_id=p_user_id;
  end if;

  return jsonb_build_object('order_id',p_order_id,'status','PENDING',
    'reserved_cash_paise',case when p_side='BUY' then v_reserve else 0 end,
    'reserved_quantity',case when p_side='SELL' then p_quantity else 0 end,
    'idempotent_replay',false,'simulation_only',true);
end;
$$;

create or replace function public.execute_paper_limit_fill(
  p_order_id text,
  p_execution_price_paise bigint,
  p_quote_timestamp_ms bigint,
  p_quote_age_ms bigint,
  p_now_ms bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.paper_orders%rowtype;
  v_account public.paper_accounts%rowtype;
  v_position public.paper_equity_positions%rowtype;
  v_gross bigint;
  v_allocated bigint;
  v_remaining_cost bigint;
  v_remaining_qty integer;
  v_cash bigint;
  v_reserved_cash bigint;
  v_reserved_qty integer;
  v_order_realized bigint := 0;
  v_realized bigint;
  v_open_count integer;
  v_has_position boolean := false;
  v_server_now_ms bigint;
  v_actual_quote_age_ms bigint;
begin
  if p_order_id is null or p_order_id !~ '^[a-f0-9]{64}$'
     or p_execution_price_paise is null or p_execution_price_paise <= 0
     or p_quote_timestamp_ms is null or p_quote_timestamp_ms <= 0
     or p_quote_age_ms is null or p_quote_age_ms < 0 or p_quote_age_ms > 15000
     or p_now_ms is null or p_now_ms < p_quote_timestamp_ms
     or p_now_ms-p_quote_timestamp_ms > 15000
     or abs((p_now_ms-p_quote_timestamp_ms)-p_quote_age_ms) > 2000 then
    raise exception using errcode='22023', message='Invalid or stale LIMIT execution quote';
  end if;
  v_server_now_ms := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if abs(v_server_now_ms-p_now_ms)>2000 or p_quote_timestamp_ms>v_server_now_ms then
    raise exception using errcode='22023', message='LIMIT quote clock is not current or timestamp is in the future';
  end if;
  v_actual_quote_age_ms := v_server_now_ms-p_quote_timestamp_ms;
  if v_actual_quote_age_ms>15000 or abs(v_actual_quote_age_ms-p_quote_age_ms)>2000 then
    raise exception using errcode='22023', message='LIMIT quote age does not match database time';
  end if;

  select * into v_order from public.paper_orders where order_id=p_order_id;
  if not found then raise exception using errcode='P0002', message='LIMIT order not found'; end if;

  select * into v_account from public.paper_accounts
   where user_id=v_order.user_id for update;
  if not found then raise exception using errcode='P0002', message='Paper account is not initialized'; end if;

  -- Re-read after acquiring the account lock; another worker/cancel may have won.
  select * into v_order from public.paper_orders where order_id=p_order_id for update;
  if v_order.status='FILLED' then
    return jsonb_build_object('order_id',p_order_id,'status','FILLED','already_filled',true);
  end if;
  if v_order.status<>'PENDING' or v_order.order_type<>'LIMIT'
     or v_order.product<>'DELIVERY' or v_order.simulation_only is not true
     or v_order.reservation_released is true then
    raise exception using errcode='23514', message='LIMIT order is not eligible for execution';
  end if;
  if (v_order.side='BUY' and p_execution_price_paise>v_order.limit_price_paise)
     or (v_order.side='SELL' and p_execution_price_paise<v_order.limit_price_paise) then
    raise exception using errcode='23514', message='Market price has not reached the LIMIT price';
  end if;

  v_gross := p_execution_price_paise::bigint*v_order.quantity::bigint;
  if v_gross <= 0 or v_gross > 9007199254740991 then
    raise exception using errcode='22003', message='LIMIT fill value exceeds supported limits';
  end if;

  select * into v_position from public.paper_equity_positions
   where user_id=v_order.user_id and product='DELIVERY'
     and instrument_key=v_order.instrument_key for update;
  v_has_position := found;

  if v_order.side='BUY' then
    if v_order.reserved_cash_paise<>v_order.limit_price_paise*v_order.quantity::bigint
       or v_order.reserved_quantity<>0
       or v_account.reserved_cash_paise<v_order.reserved_cash_paise then
      raise exception using errcode='23514', message='LIMIT BUY reservation is inconsistent';
    end if;
    if not v_has_position then
      select count(*) into v_open_count from public.paper_equity_positions
       where user_id=v_order.user_id and quantity>0;
      if v_open_count>=50 then
        raise exception using errcode='23514', message='Paper portfolio is limited to 50 open positions';
      end if;
      insert into public.paper_equity_positions(
        user_id,product,instrument_key,trading_symbol,exchange,quantity,
        average_price_paise,cost_basis_paise,reserved_quantity,updated_at
      ) values (v_order.user_id,'DELIVERY',v_order.instrument_key,
        v_order.trading_symbol,v_order.exchange,v_order.quantity,
        p_execution_price_paise,v_gross,0,now());
    else
      if v_position.quantity+v_order.quantity>1000000
         or v_position.cost_basis_paise+v_gross>9007199254740991 then
        raise exception using errcode='22003', message='LIMIT BUY position exceeds supported limits';
      end if;
      update public.paper_equity_positions set
        quantity=quantity+v_order.quantity,
        cost_basis_paise=cost_basis_paise+v_gross,
        average_price_paise=round((cost_basis_paise+v_gross)::numeric/(quantity+v_order.quantity))::bigint,
        trading_symbol=coalesce(v_order.trading_symbol,trading_symbol),
        exchange=coalesce(v_order.exchange,exchange),updated_at=now()
       where user_id=v_order.user_id and product='DELIVERY' and instrument_key=v_order.instrument_key;
    end if;
    v_cash:=v_account.cash_paise-v_gross;
    v_reserved_cash:=v_account.reserved_cash_paise-v_order.reserved_cash_paise;
    if v_cash<v_reserved_cash+v_account.reserved_margin_paise then
      raise exception using errcode='23514', message='LIMIT BUY fill would consume funds reserved by other orders';
    end if;
    update public.paper_accounts set cash_paise=v_cash,reserved_cash_paise=v_reserved_cash,
      version=version+1,updated_at=now() where user_id=v_order.user_id;
  else
    if not v_has_position or v_order.reserved_cash_paise<>0
       or v_order.reserved_quantity<>v_order.quantity
       or v_position.reserved_quantity<v_order.reserved_quantity
       or v_position.quantity<v_order.quantity then
      raise exception using errcode='23514', message='LIMIT SELL share reservation is inconsistent';
    end if;
    v_allocated:=case when v_order.quantity=v_position.quantity then v_position.cost_basis_paise
      else floor((v_position.cost_basis_paise::numeric*v_order.quantity
        + floor(v_position.quantity/2)) / v_position.quantity)::bigint end;
    v_remaining_cost:=v_position.cost_basis_paise-v_allocated;
    v_remaining_qty:=v_position.quantity-v_order.quantity;
    v_order_realized:=v_gross-v_allocated;
    v_cash:=v_account.cash_paise+v_gross;
    v_realized:=v_account.realized_pnl_paise+v_order_realized;
    if v_cash>9007199254740991 or abs(v_realized)>9007199254740991 then
      raise exception using errcode='22003', message='LIMIT SELL account totals exceed supported limits';
    end if;
    if v_remaining_qty=0 then
      delete from public.paper_equity_positions
       where user_id=v_order.user_id and product='DELIVERY' and instrument_key=v_order.instrument_key;
    else
      update public.paper_equity_positions set quantity=v_remaining_qty,
        cost_basis_paise=v_remaining_cost,
        average_price_paise=round(v_remaining_cost::numeric/v_remaining_qty)::bigint,
        reserved_quantity=reserved_quantity-v_order.reserved_quantity,updated_at=now()
       where user_id=v_order.user_id and product='DELIVERY' and instrument_key=v_order.instrument_key;
    end if;
    update public.paper_accounts set cash_paise=v_cash,realized_pnl_paise=v_realized,
      delivery_realized_pnl_paise=delivery_realized_pnl_paise+v_order_realized,
      version=version+1,updated_at=now() where user_id=v_order.user_id;
  end if;

  update public.paper_orders set status='FILLED',execution_price_paise=p_execution_price_paise,
    gross_paise=v_gross,realized_pnl_paise=v_order_realized,
    quote_timestamp_ms=p_quote_timestamp_ms,quote_age_ms=v_actual_quote_age_ms,
    reservation_released=true,worker_execution=true,filled_at=now(),updated_at=now()
   where order_id=p_order_id;

  return jsonb_build_object('order_id',p_order_id,'status','FILLED',
    'execution_price_paise',p_execution_price_paise,'gross_paise',v_gross,
    'realized_pnl_paise',v_order_realized,'simulation_only',true);
end;
$$;

create or replace function public.cancel_paper_limit_order(
  p_user_id uuid,
  p_order_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.paper_orders%rowtype;
  v_account public.paper_accounts%rowtype;
  v_position public.paper_equity_positions%rowtype;
begin
  if p_user_id is null or p_order_id is null or p_order_id !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023', message='Invalid LIMIT cancellation request';
  end if;
  select * into v_order from public.paper_orders
   where order_id=p_order_id and user_id=p_user_id;
  if not found then raise exception using errcode='P0002', message='LIMIT order not found'; end if;

  select * into v_account from public.paper_accounts where user_id=p_user_id for update;
  if not found then raise exception using errcode='P0002', message='Paper account is not initialized'; end if;
  select * into v_order from public.paper_orders where order_id=p_order_id for update;

  if v_order.status='CANCELLED' then
    return jsonb_build_object('order_id',p_order_id,'status','CANCELLED','already_cancelled',true);
  end if;
  if v_order.status<>'PENDING' or v_order.order_type<>'LIMIT'
     or v_order.reservation_released is true then
    raise exception using errcode='23514', message='Only pending LIMIT orders can be cancelled';
  end if;

  if v_order.side='BUY' then
    if v_order.reserved_cash_paise<=0
       or v_account.reserved_cash_paise<v_order.reserved_cash_paise then
      raise exception using errcode='23514', message='LIMIT BUY reservation is inconsistent';
    end if;
    update public.paper_accounts set
      reserved_cash_paise=reserved_cash_paise-v_order.reserved_cash_paise,
      version=version+1,updated_at=now() where user_id=p_user_id;
  else
    select * into v_position from public.paper_equity_positions
     where user_id=p_user_id and product='DELIVERY' and instrument_key=v_order.instrument_key
     for update;
    if not found or v_order.reserved_quantity<>v_order.quantity
       or v_position.reserved_quantity<v_order.reserved_quantity then
      raise exception using errcode='23514', message='LIMIT SELL reservation is inconsistent';
    end if;
    update public.paper_equity_positions set
      reserved_quantity=reserved_quantity-v_order.reserved_quantity,updated_at=now()
     where user_id=p_user_id and product='DELIVERY' and instrument_key=v_order.instrument_key;
    update public.paper_accounts set version=version+1,updated_at=now() where user_id=p_user_id;
  end if;

  update public.paper_orders set status='CANCELLED',reservation_released=true,
    cancelled_at=now(),updated_at=now() where order_id=p_order_id;
  return jsonb_build_object('order_id',p_order_id,'status','CANCELLED','simulation_only',true);
end;
$$;

revoke all on function public.submit_paper_limit_order(uuid,text,uuid,text,text,text,text,text,integer,bigint)
  from public, anon, authenticated;
revoke all on function public.execute_paper_limit_fill(text,bigint,bigint,bigint,bigint)
  from public, anon, authenticated;
revoke all on function public.cancel_paper_limit_order(uuid,text)
  from public, anon, authenticated;
grant execute on function public.submit_paper_limit_order(uuid,text,uuid,text,text,text,text,text,integer,bigint)
  to service_role;
grant execute on function public.execute_paper_limit_fill(text,bigint,bigint,bigint,bigint)
  to service_role;
grant execute on function public.cancel_paper_limit_order(uuid,text)
  to service_role;
