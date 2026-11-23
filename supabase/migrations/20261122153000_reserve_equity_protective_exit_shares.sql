-- Reserve equity shares for protective exits from creation through terminal state.
-- Draft integration only. No production schema is changed by this file.
-- One live protective exit per position is already enforced by the preceding partial unique index.

-- Preserve any pre-existing active draft exits when advancing the schema.
do $reservation_backfill$
begin
  if exists (
    select 1
      from public.paper_protective_orders po
      join public.paper_equity_positions ep
        on ep.user_id=po.user_id
       and ep.instrument_key=po.instrument_key
       and ep.product=po.product
     where po.asset_class='EQUITY' and po.side='SELL'
       and po.status in ('ACTIVE','TRIGGERED')
     group by ep.user_id,ep.instrument_key,ep.product,ep.quantity,ep.reserved_quantity
    having ep.quantity-ep.reserved_quantity<sum(po.quantity)
  ) then
    raise exception 'Existing protective exits exceed unreserved equity shares; reconcile before applying reservation migration';
  end if;
end;
$reservation_backfill$;

update public.paper_equity_positions ep
   set reserved_quantity=ep.reserved_quantity+active_exits.quantity,
       updated_at=now()
  from (
    select user_id,instrument_key,product,sum(quantity)::integer as quantity
      from public.paper_protective_orders
     where asset_class='EQUITY' and side='SELL'
       and status in ('ACTIVE','TRIGGERED')
     group by user_id,instrument_key,product
  ) active_exits
 where ep.user_id=active_exits.user_id
   and ep.instrument_key=active_exits.instrument_key
   and ep.product=active_exits.product;

create or replace function public.create_paper_equity_protective_order(
  p_order_id uuid,
  p_user_id uuid,
  p_instrument_key text,
  p_product text,
  p_trigger_type text,
  p_trigger_price_paise bigint,
  p_quantity integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.paper_protective_orders%rowtype;
  v_position public.paper_equity_positions%rowtype;
  v_direction text;
begin
  if p_order_id is null or p_user_id is null or auth.uid() is null
     or p_user_id is distinct from auth.uid() then
    raise exception using errcode='42501',message='Authenticated ownership is required';
  end if;
  if p_instrument_key is null or length(p_instrument_key) not between 1 and 100
     or p_product not in ('DELIVERY','INTRADAY')
     or p_trigger_type not in ('STOP_LOSS','TARGET')
     or p_trigger_price_paise is null or p_trigger_price_paise<=0
     or p_quantity is null or p_quantity not between 1 and 1000000 then
    raise exception using errcode='22023',message='Invalid equity protective order request';
  end if;
  v_direction:=case when p_trigger_type='STOP_LOSS' then 'AT_OR_BELOW' else 'AT_OR_ABOVE' end;
  perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,0));
  select * into v_existing from public.paper_protective_orders
   where order_id=p_order_id for update;
  if found then
    if v_existing.user_id is distinct from p_user_id
       or v_existing.asset_class<>'EQUITY'
       or v_existing.instrument_key is distinct from p_instrument_key
       or v_existing.product is distinct from p_product
       or v_existing.side<>'SELL'
       or v_existing.trigger_type is distinct from p_trigger_type
       or v_existing.trigger_direction is distinct from v_direction
       or v_existing.trigger_price_paise is distinct from p_trigger_price_paise
       or v_existing.quantity is distinct from p_quantity then
      raise exception using errcode='23505',message='Protective order ID was reused with different details';
    end if;
    return jsonb_build_object('order',to_jsonb(v_existing),'idempotent_replay',true);
  end if;
  select * into v_position from public.paper_equity_positions
   where user_id=p_user_id and instrument_key=p_instrument_key and product=p_product
   for update;
  if not found or v_position.quantity-v_position.reserved_quantity<p_quantity then
    raise exception using errcode='23514',message='Insufficient unreserved shares for protective order';
  end if;
  update public.paper_equity_positions
     set reserved_quantity=reserved_quantity+p_quantity,updated_at=now()
   where user_id=p_user_id and instrument_key=p_instrument_key and product=p_product;
  insert into public.paper_protective_orders(
    order_id,user_id,asset_class,instrument_key,product,side,
    trigger_type,trigger_direction,trigger_price_paise,quantity,status
  ) values (
    p_order_id,p_user_id,'EQUITY',p_instrument_key,p_product,'SELL',
    p_trigger_type,v_direction,p_trigger_price_paise,p_quantity,'ACTIVE'
  ) returning * into v_existing;
  return jsonb_build_object('order',to_jsonb(v_existing),'idempotent_replay',false);
end;
$$;

create or replace function public.cancel_paper_protective_order(
  p_protective_order_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.paper_protective_orders%rowtype;
  v_position public.paper_equity_positions%rowtype;
begin
  if p_protective_order_id is null or p_user_id is null or auth.uid() is null
     or p_user_id is distinct from auth.uid() then
    raise exception using errcode='42501', message='Authenticated ownership is required';
  end if;
  select * into v_order from public.paper_protective_orders
   where order_id=p_protective_order_id for update;
  if not found then
    raise exception using errcode='P0002', message='Protective order not found';
  end if;
  if v_order.user_id is distinct from auth.uid() then
    raise exception using errcode='42501', message='Protective order does not belong to the authenticated user';
  end if;
  if v_order.status='CANCELLED' then
    return jsonb_build_object('status','CANCELLED','idempotent_replay',true);
  end if;
  if v_order.status='FILLED' then
    return jsonb_build_object('status','FILLED','already_filled',true,'idempotent_replay',false);
  end if;
  if v_order.status not in ('ACTIVE','TRIGGERED') then
    return jsonb_build_object('status',v_order.status,'cancelled',false,'not_cancellable',true);
  end if;
  select * into v_position from public.paper_equity_positions
   where user_id=v_order.user_id and instrument_key=v_order.instrument_key
     and product=v_order.product for update;
  if not found or v_position.reserved_quantity<v_order.quantity then
    raise exception using errcode='23514',message='Protective share reservation is inconsistent';
  end if;
  update public.paper_equity_positions
     set reserved_quantity=reserved_quantity-v_order.quantity,updated_at=now()
   where user_id=v_order.user_id and instrument_key=v_order.instrument_key
     and product=v_order.product;
  update public.paper_protective_orders
     set status='CANCELLED',cancelled_at=now(),updated_at=now()
   where order_id=p_protective_order_id;
  return jsonb_build_object('status','CANCELLED','cancelled',true,'idempotent_replay',false);
end;
$$;

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
  v_allocated_cost bigint;
  v_realized bigint;
  v_remaining_qty integer;
  v_remaining_cost bigint;
  v_cash bigint;
begin
  if p_protective_order_id is null
     or p_execution_order_id is null or p_execution_order_id !~ '^[a-f0-9]{64}$'
     or p_request_fingerprint is null or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_execution_price_paise is null or p_execution_price_paise<=0
     or p_quote_timestamp_ms is null or p_quote_timestamp_ms<=0
     or p_now_ms is null or p_now_ms<=0 then
    raise exception using errcode='22023',message='Invalid protective execution request';
  end if;
  select * into v_protective from public.paper_protective_orders
   where order_id=p_protective_order_id for update;
  if not found then
    raise exception using errcode='P0002',message='Protective order not found';
  end if;
  if v_protective.status='FILLED' then
    select * into v_existing from public.paper_orders where order_id=v_protective.execution_order_id;
    if found then
      if v_protective.execution_order_id is distinct from p_execution_order_id
         or v_existing.request_fingerprint is distinct from p_request_fingerprint then
        raise exception using errcode='23505',message='Protective execution replay does not match the original request';
      end if;
      return jsonb_build_object('status','FILLED','order',to_jsonb(v_existing),'idempotent_replay',true);
    end if;
    raise exception using errcode='23514',message='Filled protective order has no linked execution record';
  end if;
  if v_protective.status not in ('ACTIVE','TRIGGERED')
     or v_protective.asset_class<>'EQUITY'
     or v_protective.product not in ('DELIVERY','INTRADAY')
     or v_protective.side<>'SELL'
     or v_protective.instrument_key is null
     or v_protective.quantity not between 1 and 1000000 then
    raise exception using errcode='23514',message='Protective order is not eligible for equity close execution';
  end if;
  if (v_protective.trigger_type='STOP_LOSS' and v_protective.trigger_direction<>'AT_OR_BELOW')
     or (v_protective.trigger_type='TARGET' and v_protective.trigger_direction<>'AT_OR_ABOVE') then
    raise exception using errcode='23514',message='Unsupported equity protective trigger direction';
  end if;
  v_server_now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if abs(v_server_now_ms-p_now_ms)>2000
     or p_quote_timestamp_ms>v_server_now_ms
     or not public._paper_quote_age_is_fresh(p_quote_timestamp_ms,v_server_now_ms) then
    raise exception using errcode='22023',message='A current, fresh quote is required';
  end if;
  v_quote_age_ms:=v_server_now_ms-p_quote_timestamp_ms;
  if (v_protective.trigger_direction='AT_OR_BELOW' and p_execution_price_paise>v_protective.trigger_price_paise)
     or (v_protective.trigger_direction='AT_OR_ABOVE' and p_execution_price_paise<v_protective.trigger_price_paise) then
    raise exception using errcode='23514',message='Protective trigger condition is not met';
  end if;
  select * into v_account from public.paper_accounts
   where user_id=v_protective.user_id for update;
  if not found then
    raise exception using errcode='P0002',message='Paper account is not initialized';
  end if;
  select * into v_position from public.paper_equity_positions
   where user_id=v_protective.user_id and product=v_protective.product
     and instrument_key=v_protective.instrument_key for update;
  if not found or v_position.quantity<v_protective.quantity
     or v_position.reserved_quantity<v_protective.quantity then
    raise exception using errcode='23514',message='Protective share reservation is inconsistent';
  end if;
  if exists(select 1 from public.paper_orders where order_id=p_execution_order_id) then
    raise exception using errcode='23505',message='Execution order ID already exists';
  end if;
  v_gross:=p_execution_price_paise::bigint*v_protective.quantity::bigint;
  if v_gross<=0 or v_gross>9007199254740991 then
    raise exception using errcode='22003',message='Protective fill value exceeds supported limits';
  end if;
  v_allocated_cost:=case when v_protective.quantity=v_position.quantity then v_position.cost_basis_paise
    else floor((v_position.cost_basis_paise::numeric*v_protective.quantity
      +floor(v_position.quantity/2))/v_position.quantity)::bigint end;
  v_remaining_qty:=v_position.quantity-v_protective.quantity;
  v_remaining_cost:=v_position.cost_basis_paise-v_allocated_cost;
  v_realized:=v_gross-v_allocated_cost;
  v_cash:=v_account.cash_paise+v_gross;
  if v_cash>9007199254740991
     or abs(v_account.realized_pnl_paise+v_realized)>9007199254740991 then
    raise exception using errcode='22003',message='Equity protective account totals exceed supported limits';
  end if;
  insert into public.paper_orders(
    order_id,user_id,idempotency_key,request_fingerprint,instrument_key,
    trading_symbol,exchange,side,product,order_type,status,quantity,
    execution_price_paise,gross_paise,realized_pnl_paise,
    quote_timestamp_ms,quote_age_ms,reservation_released,worker_execution,
    simulation_only,created_at,updated_at,filled_at
  ) values (
    p_execution_order_id,v_protective.user_id,null,p_request_fingerprint,
    v_protective.instrument_key,v_position.trading_symbol,v_position.exchange,
    'SELL',v_protective.product,'MARKET','FILLED',v_protective.quantity,
    p_execution_price_paise,v_gross,v_realized,p_quote_timestamp_ms,v_quote_age_ms,
    true,true,true,now(),now(),now()
  );
  if v_remaining_qty=0 then
    delete from public.paper_equity_positions where user_id=v_protective.user_id
      and product=v_protective.product and instrument_key=v_protective.instrument_key;
  else
    update public.paper_equity_positions set quantity=v_remaining_qty,
      cost_basis_paise=v_remaining_cost,
      average_price_paise=round(v_remaining_cost::numeric/v_remaining_qty)::bigint,
      reserved_quantity=reserved_quantity-v_protective.quantity,updated_at=now()
     where user_id=v_protective.user_id and product=v_protective.product
       and instrument_key=v_protective.instrument_key;
  end if;
  update public.paper_accounts set cash_paise=v_cash,
    realized_pnl_paise=realized_pnl_paise+v_realized,
    delivery_realized_pnl_paise=delivery_realized_pnl_paise
      +case when v_protective.product='DELIVERY' then v_realized else 0 end,
    intraday_realized_pnl_paise=intraday_realized_pnl_paise
      +case when v_protective.product='INTRADAY' then v_realized else 0 end,
    version=version+1,updated_at=now() where user_id=v_protective.user_id;
  update public.paper_protective_orders set status='FILLED',
    execution_price_paise=p_execution_price_paise,execution_order_id=p_execution_order_id,
    execution_quote_timestamp_ms=p_quote_timestamp_ms,execution_quote_age_ms=v_quote_age_ms,
    filled_at=now(),updated_at=now() where order_id=p_protective_order_id;
  return jsonb_build_object('status','FILLED','execution_order_id',p_execution_order_id,
    'execution_price_paise',p_execution_price_paise,'gross_paise',v_gross,
    'realized_pnl_paise',v_realized,'simulation_only',true,'idempotent_replay',false);
end;
$$;

revoke all on function public.create_paper_equity_protective_order(uuid,uuid,text,text,text,bigint,integer)
  from public,anon,authenticated;
grant execute on function public.create_paper_equity_protective_order(uuid,uuid,text,text,text,bigint,integer)
  to authenticated;
revoke all on function public.cancel_paper_protective_order(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_paper_protective_order(uuid,uuid) to authenticated;
revoke all on function public.execute_paper_equity_protective_fill(uuid,text,text,bigint,bigint,bigint)
  from public,anon,authenticated;
grant execute on function public.execute_paper_equity_protective_fill(uuid,text,text,bigint,bigint,bigint)
  to service_role;
