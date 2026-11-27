-- Atomically modify an active cash-equity protective exit without releasing its share reservation.
-- Authenticated owner only. The same order row is locked by the fill/cancel paths.
-- Draft integration only: do not apply to hosted Supabase until the migration gate is approved.
create or replace function public.modify_paper_equity_protective_order(
  p_protective_order_id uuid,
  p_user_id uuid,
  p_trigger_type text,
  p_trigger_price_paise bigint,
  p_quantity integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.paper_protective_orders%rowtype;
  v_position public.paper_equity_positions%rowtype;
  v_direction text;
  v_quantity_delta integer;
begin
  if p_protective_order_id is null or p_user_id is null
     or auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception using errcode='42501',message='Authenticated ownership is required';
  end if;
  if p_trigger_type not in ('STOP_LOSS','TARGET')
     or p_trigger_price_paise is null or p_trigger_price_paise<=0
     or p_quantity is null or p_quantity not between 1 and 1000000 then
    raise exception using errcode='22023',message='Invalid equity protective order modification';
  end if;

  select * into v_order
    from public.paper_protective_orders
   where order_id=p_protective_order_id
   for update;
  if not found then
    raise exception using errcode='P0002',message='Protective order not found';
  end if;
  if v_order.user_id is distinct from auth.uid() then
    raise exception using errcode='42501',message='Protective order does not belong to the authenticated user';
  end if;
  if v_order.asset_class<>'EQUITY' or v_order.side<>'SELL'
     or v_order.product not in ('DELIVERY','INTRADAY')
     or v_order.status<>'ACTIVE' then
    raise exception using errcode='23514',message='Only active cash-equity protective orders can be modified';
  end if;

  v_direction:=case when p_trigger_type='STOP_LOSS' then 'AT_OR_BELOW' else 'AT_OR_ABOVE' end;
  if v_order.trigger_type=p_trigger_type
     and v_order.trigger_direction=v_direction
     and v_order.trigger_price_paise=p_trigger_price_paise
     and v_order.quantity=p_quantity then
    return jsonb_build_object('order',to_jsonb(v_order),'idempotent_replay',true);
  end if;

  select * into v_position
    from public.paper_equity_positions
   where user_id=v_order.user_id
     and instrument_key=v_order.instrument_key
     and product=v_order.product
   for update;
  if not found then
    raise exception using errcode='23514',message='Protective share reservation is missing';
  end if;

  if v_position.reserved_quantity<v_order.quantity then
    raise exception using errcode='23514',message='Protective share reservation is inconsistent';
  end if;

  v_quantity_delta:=p_quantity-v_order.quantity;
  if v_quantity_delta>0 and v_position.quantity-v_position.reserved_quantity<v_quantity_delta then
    raise exception using errcode='23514',message='Insufficient unreserved shares for increased protective quantity';
  end if;
  if v_position.reserved_quantity+v_quantity_delta<0
     or v_position.reserved_quantity+v_quantity_delta>v_position.quantity then
    raise exception using errcode='23514',message='Protective share reservation would become invalid';
  end if;

  if v_quantity_delta<>0 then
    update public.paper_equity_positions
       set reserved_quantity=reserved_quantity+v_quantity_delta,
           updated_at=now()
     where user_id=v_order.user_id
       and instrument_key=v_order.instrument_key
       and product=v_order.product;
  end if;

  update public.paper_protective_orders
     set trigger_type=p_trigger_type,
         trigger_direction=v_direction,
         trigger_price_paise=p_trigger_price_paise,
         quantity=p_quantity,
         updated_at=now()
   where order_id=p_protective_order_id
   returning * into v_order;

  return jsonb_build_object('order',to_jsonb(v_order),'idempotent_replay',false);
end;
$$;

revoke all on function public.modify_paper_equity_protective_order(uuid,uuid,text,bigint,integer)
  from public,anon,authenticated;
grant execute on function public.modify_paper_equity_protective_order(uuid,uuid,text,bigint,integer)
  to authenticated;
