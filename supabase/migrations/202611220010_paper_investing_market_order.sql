-- Transaction-safe Paper Investing MARKET orders on a separate virtual ledger.
create or replace function public.execute_paper_investing_market_order(
  p_user_id uuid,p_order_id text,p_idempotency_key uuid,p_request_fingerprint text,
  p_instrument_key text,p_trading_symbol text,p_exchange text,p_side text,
  p_quantity integer,p_execution_price_paise bigint,p_tick_size_paise integer,
  p_charges_paise bigint,p_quote_timestamp_ms bigint,p_now_ms bigint
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_account public.paper_investing_accounts%rowtype;
  v_existing public.paper_investing_orders%rowtype;
  v_position public.paper_investing_positions%rowtype;
  v_has_position boolean:=false;
  v_server_now bigint;
  v_gross bigint;
  v_total_debit bigint;
  v_net_proceeds bigint;
  v_allocated_cost bigint;
  v_remaining_cost bigint;
  v_new_qty bigint;
  v_new_cost bigint;
  v_new_avg bigint;
  v_realized bigint:=0;
  v_new_cash bigint;
  v_order jsonb;
begin
  if p_user_id is null or p_order_id is null or p_order_id !~ '^[a-f0-9]{64}$'
     or p_idempotency_key is null
     or p_request_fingerprint is null or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_instrument_key is null or length(p_instrument_key) not between 1 and 100
     or p_trading_symbol is null or length(p_trading_symbol) not between 1 and 100
     or p_exchange is null or p_exchange not in ('NSE','BSE')
     or p_side is null or p_side not in ('BUY','SELL')
     or p_quantity is null or p_quantity not between 1 and 1000000
     or p_execution_price_paise is null or p_execution_price_paise<=0
     or p_tick_size_paise is null or p_tick_size_paise not between 1 and 1000000
     or p_execution_price_paise%p_tick_size_paise<>0
     or p_charges_paise is null or p_charges_paise<0
     or p_quote_timestamp_ms is null or p_now_ms is null
     or p_quote_timestamp_ms<0 or p_now_ms<0 then
    raise exception 'Invalid Paper Investing order input.' using errcode='22023';
  end if;
  v_server_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if abs(v_server_now-p_now_ms)>2000 or not public._paper_quote_age_is_fresh(p_quote_timestamp_ms,v_server_now) then
    raise exception 'A matching fresh provider quote is required.' using errcode='22023';
  end if;
  v_gross:=p_execution_price_paise::bigint*p_quantity::bigint;
  if v_gross<=0 or v_gross>9000000000000000 then
    raise exception 'Paper Investing turnover exceeds supported limits.' using errcode='22003';
  end if;

  select * into v_account from public.paper_investing_accounts
   where user_id=p_user_id for update;
  if not found then raise exception 'Paper Investing account is not initialized.' using errcode='P0002'; end if;

  select * into v_existing from public.paper_investing_orders
   where user_id=p_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.order_id<>p_order_id or v_existing.request_fingerprint<>p_request_fingerprint then
      raise exception 'Paper Investing idempotency key was reused with different order details.' using errcode='23505';
    end if;
    return jsonb_build_object('order',to_jsonb(v_existing),'cash_paise',v_account.cash_paise,
      'realized_pnl_paise',v_account.realized_pnl_paise,'idempotent_replay',true,'simulation_only',true);
  end if;

  select * into v_position from public.paper_investing_positions
   where user_id=p_user_id and instrument_key=p_instrument_key for update;
  v_has_position:=found;
  if v_has_position and v_position.exchange<>p_exchange then
    raise exception 'Instrument exchange does not match the existing Paper Investing position.' using errcode='23514';
  end if;

  if p_side='BUY' then
    v_total_debit:=v_gross+p_charges_paise;
    if v_total_debit<=0 or v_account.cash_paise-v_account.reserved_cash_paise<v_total_debit then
      raise exception 'Insufficient Paper Investing virtual cash.' using errcode='23514';
    end if;
    v_new_qty:=coalesce(v_position.quantity,0)+p_quantity;
    if v_new_qty>1000000 then raise exception 'Paper Investing position quantity limit exceeded.' using errcode='22003'; end if;
    v_new_cost:=coalesce(v_position.cost_basis_paise,0)+v_total_debit;
    v_new_avg:=round(v_new_cost::numeric/v_new_qty)::bigint;
    v_new_cash:=v_account.cash_paise-v_total_debit;
    insert into public.paper_investing_positions(
      user_id,instrument_key,trading_symbol,exchange,quantity,average_price_paise,cost_basis_paise,realized_pnl_paise,updated_at
    ) values(
      p_user_id,p_instrument_key,p_trading_symbol,p_exchange,v_new_qty,v_new_avg,v_new_cost,0,now()
    )
    on conflict(user_id,instrument_key) do update set
      trading_symbol=excluded.trading_symbol,exchange=excluded.exchange,
      quantity=excluded.quantity,average_price_paise=excluded.average_price_paise,
      cost_basis_paise=excluded.cost_basis_paise,updated_at=now();
  else
    if not v_has_position or p_quantity>v_position.quantity then
      raise exception 'Insufficient Paper Investing shares available to sell.' using errcode='23514';
    end if;
    v_allocated_cost:=floor(v_position.cost_basis_paise::numeric*p_quantity::numeric/v_position.quantity::numeric)::bigint;
    v_remaining_cost:=v_position.cost_basis_paise-v_allocated_cost;
    v_net_proceeds:=v_gross-p_charges_paise;
    if v_net_proceeds<0 then raise exception 'Selling charges exceed the proceeds.' using errcode='23514'; end if;
    v_realized:=v_net_proceeds-v_allocated_cost;
    v_new_cash:=v_account.cash_paise+v_net_proceeds;
    v_new_qty:=v_position.quantity-p_quantity;
    if v_new_qty=0 then
      delete from public.paper_investing_positions where user_id=p_user_id and instrument_key=p_instrument_key;
    else
      v_new_avg:=round(v_remaining_cost::numeric/v_new_qty)::bigint;
      update public.paper_investing_positions
         set quantity=v_new_qty,cost_basis_paise=v_remaining_cost,
             average_price_paise=v_new_avg,realized_pnl_paise=realized_pnl_paise+v_realized,
             updated_at=now()
       where user_id=p_user_id and instrument_key=p_instrument_key;
    end if;
  end if;

  update public.paper_investing_accounts
     set cash_paise=v_new_cash,realized_pnl_paise=realized_pnl_paise+v_realized,
         version=version+1,updated_at=now()
   where user_id=p_user_id;

  insert into public.paper_investing_orders(
    order_id,user_id,idempotency_key,request_fingerprint,instrument_key,trading_symbol,
    exchange,side,order_type,status,quantity,execution_price_paise,gross_paise,
    charges_paise,realized_pnl_paise,quote_timestamp_ms,quote_age_ms,
    simulation_only,created_at,updated_at,filled_at
  ) values(
    p_order_id,p_user_id,p_idempotency_key,p_request_fingerprint,p_instrument_key,p_trading_symbol,
    p_exchange,p_side,'MARKET','FILLED',p_quantity,p_execution_price_paise,v_gross,
    p_charges_paise,v_realized,p_quote_timestamp_ms,v_server_now-p_quote_timestamp_ms,
    true,now(),now(),now()
  );
  select to_jsonb(o) into v_order from public.paper_investing_orders o where o.order_id=p_order_id;
  return jsonb_build_object('order',v_order,'cash_paise',v_new_cash,
    'realized_pnl_paise',v_realized,'idempotent_replay',false,'simulation_only',true);
end;
$$;
revoke all on function public.execute_paper_investing_market_order(uuid,text,uuid,text,text,text,text,text,integer,bigint,integer,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.execute_paper_investing_market_order(uuid,text,uuid,text,text,text,text,text,integer,bigint,integer,bigint,bigint,bigint) to service_role;
