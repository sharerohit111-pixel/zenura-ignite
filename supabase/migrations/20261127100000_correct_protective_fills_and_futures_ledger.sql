-- Forward-only accounting and ledger-integrity corrections.
-- Draft only: rehearse on disposable PostgreSQL and staging before any hosted rollout.

-- A protective SELL is a real simulated exchange settlement, not a gross cash credit.
-- Reuse the same exchange fee resolver as ordinary MARKET settlement. BSE remains
-- fail-closed when the official, sufficiently fresh scrip master is unavailable.
create or replace function public.execute_paper_equity_protective_fill(
  p_protective_order_id uuid,
  p_execution_order_id text,
  p_request_fingerprint text,
  p_execution_price_paise bigint,
  p_quote_timestamp_ms bigint,
  p_now_ms bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_protective public.paper_protective_orders%rowtype;
  v_account public.paper_accounts%rowtype;
  v_position public.paper_equity_positions%rowtype;
  v_existing public.paper_orders%rowtype;
  v_server_now_ms bigint;
  v_quote_age_ms bigint;
  v_gross bigint;
  v_charges bigint;
  v_breakdown jsonb;
  v_net_proceeds bigint;
  v_cash_delta bigint;
  v_allocated_cost bigint;
  v_realized bigint;
  v_remaining_qty integer;
  v_remaining_cost bigint;
  v_cash bigint;
begin
  if p_protective_order_id is null
     or p_execution_order_id is null or p_execution_order_id !~ '^[a-f0-9]{64}$'
     or p_request_fingerprint is null or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_execution_price_paise is null or p_execution_price_paise <= 0
     or p_quote_timestamp_ms is null or p_quote_timestamp_ms <= 0
     or p_now_ms is null or p_now_ms <= 0 then
    raise exception using errcode='22023', message='Invalid protective execution request';
  end if;

  select * into v_protective
    from public.paper_protective_orders
   where order_id=p_protective_order_id
   for update;
  if not found then
    raise exception using errcode='P0002', message='Protective order not found';
  end if;

  if v_protective.status='FILLED' then
    select * into v_existing from public.paper_orders
     where order_id=v_protective.execution_order_id;
    if found then
      if v_protective.execution_order_id is distinct from p_execution_order_id
         or v_existing.request_fingerprint is distinct from p_request_fingerprint then
        raise exception using errcode='23505', message='Protective execution replay does not match the original request';
      end if;
      return jsonb_build_object('status','FILLED','order',to_jsonb(v_existing),'idempotent_replay',true);
    end if;
    raise exception using errcode='23514', message='Filled protective order has no linked execution record';
  end if;

  if v_protective.status not in ('ACTIVE','TRIGGERED')
     or v_protective.asset_class<>'EQUITY'
     or v_protective.product not in ('DELIVERY','INTRADAY')
     or v_protective.side<>'SELL'
     or v_protective.instrument_key is null
     or v_protective.quantity not between 1 and 1000000 then
    raise exception using errcode='23514', message='Protective order is not eligible for equity close execution';
  end if;

  if (v_protective.trigger_type='STOP_LOSS'
      and v_protective.trigger_direction<>'AT_OR_BELOW')
     or (v_protective.trigger_type='TARGET'
      and v_protective.trigger_direction<>'AT_OR_ABOVE') then
    raise exception using errcode='23514', message='Unsupported equity protective trigger direction';
  end if;

  v_server_now_ms := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if abs(v_server_now_ms-p_now_ms)>2000
     or p_quote_timestamp_ms>v_server_now_ms
     or not public._paper_quote_age_is_fresh(p_quote_timestamp_ms,v_server_now_ms) then
    raise exception using errcode='22023', message='A current, fresh quote is required';
  end if;
  v_quote_age_ms := v_server_now_ms-p_quote_timestamp_ms;

  if (v_protective.trigger_direction='AT_OR_BELOW'
      and p_execution_price_paise>v_protective.trigger_price_paise)
     or (v_protective.trigger_direction='AT_OR_ABOVE'
      and p_execution_price_paise<v_protective.trigger_price_paise) then
    raise exception using errcode='23514', message='Protective trigger condition is not met';
  end if;

  select * into v_account from public.paper_accounts
   where user_id=v_protective.user_id for update;
  if not found then
    raise exception using errcode='P0002', message='Paper account is not initialized';
  end if;

  select * into v_position from public.paper_equity_positions
   where user_id=v_protective.user_id
     and product=v_protective.product
     and instrument_key=v_protective.instrument_key
   for update;
  if not found
     or v_position.quantity-v_position.reserved_quantity<v_protective.quantity then
    raise exception using errcode='23514', message='Insufficient unreserved equity quantity';
  end if;
  if v_position.exchange not in ('NSE','BSE') then
    raise exception using errcode='22023', message='Protective equity fill requires a supported exchange fee schedule';
  end if;

  if exists(select 1 from public.paper_orders where order_id=p_execution_order_id) then
    raise exception using errcode='23505', message='Execution order ID already exists';
  end if;

  v_gross := p_execution_price_paise::bigint*v_protective.quantity::bigint;
  if v_gross<=0 or v_gross>9007199254740991 then
    raise exception using errcode='22003', message='Protective fill value exceeds supported limits';
  end if;

  v_breakdown:=public._paper_cash_equity_charges(
    v_protective.instrument_key,v_position.exchange,v_gross,
    v_protective.product,'SELL'
  );
  v_charges:=(v_breakdown->>'total_charges_paise')::bigint;
  v_net_proceeds:=v_gross-v_charges;
  if v_charges<0 or v_net_proceeds<=0
     or v_gross+v_charges>9007199254740991 then
    raise exception using errcode='22003', message='Protective SELL charges exceed supported net settlement limits';
  end if;
  v_cash_delta:=v_net_proceeds;

  v_allocated_cost := case
    when v_protective.quantity=v_position.quantity then v_position.cost_basis_paise
    else floor((v_position.cost_basis_paise::numeric*v_protective.quantity
      + floor(v_position.quantity/2)) / v_position.quantity)::bigint
  end;
  v_remaining_qty := v_position.quantity-v_protective.quantity;
  v_remaining_cost := v_position.cost_basis_paise-v_allocated_cost;
  v_realized := v_net_proceeds-v_allocated_cost;
  v_cash := v_account.cash_paise+v_cash_delta;

  if v_cash>9007199254740991
     or abs(v_account.realized_pnl_paise+v_realized)>9007199254740991
     or abs(v_account.delivery_realized_pnl_paise
       +case when v_protective.product='DELIVERY' then v_realized else 0 end)>9007199254740991
     or abs(v_account.intraday_realized_pnl_paise
       +case when v_protective.product='INTRADAY' then v_realized else 0 end)>9007199254740991 then
    raise exception using errcode='22003', message='Equity protective account totals exceed supported limits';
  end if;

  insert into public.paper_orders(
    order_id,user_id,idempotency_key,request_fingerprint,instrument_key,
    trading_symbol,exchange,side,product,order_type,status,quantity,
    execution_price_paise,gross_paise,charges_paise,charges_breakdown,
    cash_delta_paise,realized_pnl_paise,
    quote_timestamp_ms,quote_age_ms,reservation_released,worker_execution,
    simulation_only,created_at,updated_at,filled_at
  ) values (
    p_execution_order_id,v_protective.user_id,null,p_request_fingerprint,
    v_protective.instrument_key,v_position.trading_symbol,v_position.exchange,
    'SELL',v_protective.product,'MARKET','FILLED',v_protective.quantity,
    p_execution_price_paise,v_gross,v_charges,v_breakdown,v_cash_delta,v_realized,
    p_quote_timestamp_ms,v_quote_age_ms,true,true,true,now(),now(),now()
  );

  if v_remaining_qty=0 then
    delete from public.paper_equity_positions
     where user_id=v_protective.user_id
       and product=v_protective.product
       and instrument_key=v_protective.instrument_key;
  else
    update public.paper_equity_positions
       set quantity=v_remaining_qty,
           cost_basis_paise=v_remaining_cost,
           average_price_paise=round(v_remaining_cost::numeric/v_remaining_qty)::bigint,
           updated_at=now()
     where user_id=v_protective.user_id
       and product=v_protective.product
       and instrument_key=v_protective.instrument_key;
  end if;

  update public.paper_accounts
     set cash_paise=v_cash,
         realized_pnl_paise=realized_pnl_paise+v_realized,
         delivery_realized_pnl_paise=delivery_realized_pnl_paise
           +case when v_protective.product='DELIVERY' then v_realized else 0 end,
         intraday_realized_pnl_paise=intraday_realized_pnl_paise
           +case when v_protective.product='INTRADAY' then v_realized else 0 end,
         version=version+1,updated_at=now()
   where user_id=v_protective.user_id;

  update public.paper_protective_orders
     set status='FILLED',execution_price_paise=p_execution_price_paise,
         execution_order_id=p_execution_order_id,
         execution_quote_timestamp_ms=p_quote_timestamp_ms,
         execution_quote_age_ms=v_quote_age_ms,
         filled_at=now(),updated_at=now()
   where order_id=p_protective_order_id;

  return jsonb_build_object(
    'status','FILLED','execution_order_id',p_execution_order_id,
    'execution_price_paise',p_execution_price_paise,'gross_paise',v_gross,
    'charges_paise',v_charges,'charges_breakdown',v_breakdown,
    'cash_delta_paise',v_cash_delta,'realized_pnl_paise',v_realized,
    'simulation_only',true,'idempotent_replay',false
  );
end;
$$;

revoke all on function public.execute_paper_equity_protective_fill(uuid,text,text,bigint,bigint,bigint)
  from public,anon,authenticated;
grant execute on function public.execute_paper_equity_protective_fill(uuid,text,text,bigint,bigint,bigint)
  to service_role;

-- Legacy MARKET orders are terminal; they never retain an open LIMIT remainder.
update public.paper_futures_orders
   set filled_quantity=case when status='FILLED' then quantity else 0 end,
       remaining_quantity=0,
       average_fill_price_paise=case when status='FILLED' then execution_price_paise else null end,
       reserved_open_margin_paise=0,
       reserved_close_quantity=0
 where order_type='MARKET';

-- The atomic Futures fill RPC is SECURITY DEFINER and owner-executed. The gateway
-- only needs direct read access; all writes must pass through that RPC.
revoke insert,update,delete on table public.paper_futures_fills from service_role;
grant select on table public.paper_futures_fills to service_role;

