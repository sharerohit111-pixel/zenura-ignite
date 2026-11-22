-- DRAFT ONLY. Apply only after review, staging tests and explicit approval.
-- Atomic MARKET BUY/SELL RPC. Uses integer paise and PostgreSQL row locks.
-- Pending LIMIT and derivatives are intentionally handled by separate RPCs.
-- Shared deterministic quote-age predicate. Kept non-callable by API roles;
-- SECURITY DEFINER transaction RPCs invoke it as their owner.
create or replace function public._paper_quote_age_is_fresh(
  p_quote_timestamp_ms bigint,
  p_server_now_ms bigint
) returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $quote_age$
  select p_quote_timestamp_ms is not null
     and p_server_now_ms is not null
     and p_quote_timestamp_ms <= p_server_now_ms
     and (p_server_now_ms::numeric-p_quote_timestamp_ms::numeric) between 0 and 15000;
$quote_age$;
revoke all on function public._paper_quote_age_is_fresh(bigint,bigint)
  from public, anon, authenticated, service_role;

create or replace function public.execute_paper_market_order(
  p_user_id uuid,
  p_order_id text,
  p_idempotency_key uuid,
  p_request_fingerprint text,
  p_instrument_key text,
  p_trading_symbol text,
  p_exchange text,
  p_side text,
  p_product text,
  p_quantity integer,
  p_execution_price_paise bigint,
  p_quote_timestamp_ms bigint,
  p_quote_age_ms bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.paper_accounts%rowtype;
  v_position public.paper_equity_positions%rowtype;
  v_has_position boolean := false;
  v_open_count integer;
  v_reserved_qty integer := 0;
  v_gross bigint;
  v_cost bigint;
  v_allocated_cost bigint;
  v_remaining_cost bigint;
  v_remaining_qty integer;
  v_new_qty integer;
  v_new_cost bigint;
  v_new_average bigint;
  v_cash bigint;
  v_available_cash bigint;
  v_mode_realized bigint;
  v_aggregate_realized bigint;
  v_order_realized bigint := 0;
  v_order public.paper_orders%rowtype;
  v_now_ms bigint;
  v_actual_quote_age_ms bigint;
begin
  if p_user_id is null or p_idempotency_key is null
     or p_order_id is null or p_request_fingerprint is null
     or p_side is null or p_product is null or p_quantity is null
     or p_execution_price_paise is null or p_order_id !~ '^[a-f0-9]{64}$'
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_instrument_key is null or length(p_instrument_key) not between 1 and 100
     or p_side not in ('BUY','SELL')
     or p_product not in ('DELIVERY','INTRADAY')
     or p_quantity not between 1 and 1000000
     or p_execution_price_paise <= 0
     or p_quote_timestamp_ms is null or p_quote_timestamp_ms <= 0
     or p_quote_age_ms is null or p_quote_age_ms < 0
     or p_quote_age_ms > 15000 then
    raise exception using errcode='22023', message='Invalid or stale paper market order request';
  end if;

  -- Never trust a caller-supplied quote age or clock: derive freshness from PostgreSQL time.
  v_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_actual_quote_age_ms := v_now_ms - p_quote_timestamp_ms;
  if not public._paper_quote_age_is_fresh(p_quote_timestamp_ms,v_now_ms)
     or abs(v_actual_quote_age_ms - p_quote_age_ms) > 2000 then
    raise exception using errcode='22023', message='Invalid or stale paper market quote';
  end if;

  -- Lock account first: serializes all cash/position/order mutations for this user.
  select * into v_account from public.paper_accounts
   where user_id=p_user_id for update;
  if not found then
    raise exception using errcode='P0002', message='Paper account is not initialized';
  end if;

  if v_account.reserved_cash_paise + v_account.reserved_margin_paise > v_account.cash_paise
     or v_account.reserved_cash_paise < 0 or v_account.reserved_margin_paise < 0 then
    raise exception using errcode='23514', message='Invalid account reservations';
  end if;

  -- Idempotent retry: return the existing result, but reject key reuse with
  -- a different fingerprint. Account lock makes the check/create sequence safe.
  select * into v_order from public.paper_orders
   where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_order.request_fingerprint <> p_request_fingerprint then
      raise exception using errcode='23505', message='Idempotency key reused for a different order';
    end if;
    return jsonb_build_object('order_id',v_order.order_id,'status',v_order.status,
      'cash_paise',v_account.cash_paise,'realized_pnl_paise',v_account.realized_pnl_paise,
      'idempotent_replay',true,'simulation_only',true);
  end if;

  if exists(select 1 from public.paper_orders where order_id=p_order_id) then
    raise exception using errcode='23505', message='Order ID already exists';
  end if;

  v_gross := p_execution_price_paise::bigint * p_quantity::bigint;
  if v_gross <= 0 or v_gross > 9007199254740991 then
    raise exception using errcode='22003', message='Order value exceeds supported limits';
  end if;
  v_available_cash := v_account.cash_paise - v_account.reserved_cash_paise - v_account.reserved_margin_paise;
  v_cash := v_account.cash_paise;
  v_aggregate_realized := v_account.realized_pnl_paise;
  v_mode_realized := case when p_product='DELIVERY'
    then v_account.delivery_realized_pnl_paise else v_account.intraday_realized_pnl_paise end;

  select * into v_position from public.paper_equity_positions
   where user_id=p_user_id and product=p_product and instrument_key=p_instrument_key
   for update;
  v_has_position := found;

  if p_side='BUY' then
    if not v_has_position then
      select count(*) into v_open_count from public.paper_equity_positions
       where user_id=p_user_id and quantity > 0;
      if v_open_count >= 50 then
        raise exception using errcode='23514', message='Paper portfolio is limited to 50 open positions';
      end if;
      if v_available_cash < v_gross then
        raise exception using errcode='23514', message='Insufficient unreserved virtual cash';
      end if;
      insert into public.paper_equity_positions(
        user_id,product,instrument_key,trading_symbol,exchange,quantity,
        average_price_paise,cost_basis_paise,reserved_quantity,updated_at
      ) values (
        p_user_id,p_product,p_instrument_key,p_trading_symbol,p_exchange,p_quantity,
        p_execution_price_paise,v_gross,0,now()
      );
    else
      if v_position.quantity + p_quantity > 1000000 then
        raise exception using errcode='22003', message='Position quantity exceeds supported limit';
      end if;
      v_new_qty := v_position.quantity + p_quantity;
      v_new_cost := v_position.cost_basis_paise + v_gross;
      if v_new_cost > 9007199254740991 or v_available_cash < v_gross then
        raise exception using errcode='23514', message='Insufficient cash or unsupported position cost';
      end if;
      v_new_average := round(v_new_cost::numeric / v_new_qty)::bigint;
      update public.paper_equity_positions set
        quantity=v_new_qty,average_price_paise=v_new_average,cost_basis_paise=v_new_cost,
        trading_symbol=coalesce(p_trading_symbol,trading_symbol),
        exchange=coalesce(p_exchange,exchange),updated_at=now()
       where user_id=p_user_id and product=p_product and instrument_key=p_instrument_key;
    end if;
    v_cash := v_account.cash_paise - v_gross;
  else
    if not v_has_position then
      raise exception using errcode='23514', message='No position available to sell';
    end if;
    v_reserved_qty := v_position.reserved_quantity;
    if p_quantity > v_position.quantity - v_reserved_qty then
      raise exception using errcode='23514', message='Insufficient unreserved shares';
    end if;
    v_cost := v_position.cost_basis_paise;
    v_allocated_cost := case when p_quantity=v_position.quantity then v_cost
      else floor((v_cost::numeric*p_quantity + floor(v_position.quantity/2)) / v_position.quantity)::bigint end;
    v_remaining_cost := v_cost - v_allocated_cost;
    v_remaining_qty := v_position.quantity - p_quantity;
    v_order_realized := v_gross - v_allocated_cost;
    if v_remaining_qty=0 then
      delete from public.paper_equity_positions
       where user_id=p_user_id and product=p_product and instrument_key=p_instrument_key;
    else
      update public.paper_equity_positions set quantity=v_remaining_qty,
        cost_basis_paise=v_remaining_cost,
        average_price_paise=round(v_remaining_cost::numeric/v_remaining_qty)::bigint,
        updated_at=now()
       where user_id=p_user_id and product=p_product and instrument_key=p_instrument_key;
    end if;
    v_cash := v_account.cash_paise + v_gross;
    v_aggregate_realized := v_aggregate_realized + v_order_realized;
    v_mode_realized := v_mode_realized + v_order_realized;
    if v_cash > 9007199254740991 or abs(v_aggregate_realized) > 9007199254740991
       or abs(v_mode_realized) > 9007199254740991 then
      raise exception using errcode='22003', message='Account balance or P&L exceeds supported limits';
    end if;
  end if;

  insert into public.paper_orders(
    order_id,user_id,idempotency_key,request_fingerprint,instrument_key,
    trading_symbol,exchange,side,product,order_type,status,quantity,
    execution_price_paise,gross_paise,realized_pnl_paise,quote_timestamp_ms,
    quote_age_ms,reservation_released,simulation_only,filled_at,created_at,updated_at
  ) values (
    p_order_id,p_user_id,p_idempotency_key,p_request_fingerprint,p_instrument_key,
    p_trading_symbol,p_exchange,p_side,p_product,'MARKET','FILLED',p_quantity,
    p_execution_price_paise,v_gross,v_order_realized,p_quote_timestamp_ms,
    v_actual_quote_age_ms,true,true,now(),now(),now()
  );

  update public.paper_accounts set cash_paise=v_cash,
    realized_pnl_paise=v_aggregate_realized,
    delivery_realized_pnl_paise=case when p_product='DELIVERY' then v_mode_realized else delivery_realized_pnl_paise end,
    intraday_realized_pnl_paise=case when p_product='INTRADAY' then v_mode_realized else intraday_realized_pnl_paise end,
    version=version+1,updated_at=now()
   where user_id=p_user_id;

  return jsonb_build_object('order_id',p_order_id,'status','FILLED',
    'cash_paise',v_cash,'gross_paise',v_gross,
    'realized_pnl_paise',v_aggregate_realized,
    'order_realized_pnl_paise',v_order_realized,
    'idempotent_replay',false,'simulation_only',true);
end;
$$;

revoke all on function public.execute_paper_market_order(
  uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint
) from public, anon, authenticated;
grant execute on function public.execute_paper_market_order(
  uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint
) to service_role;
