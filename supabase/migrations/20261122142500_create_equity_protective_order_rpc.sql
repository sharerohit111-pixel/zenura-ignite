-- Authenticated, idempotent creation for supported cash-equity SELL protective exits.
-- Protective orders do not reserve shares; the atomic fill RPC rechecks unreserved quantity.
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

  -- Serialize duplicate retries using the same client-generated order UUID.
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

revoke all on function public.create_paper_equity_protective_order(uuid,uuid,text,text,text,bigint,integer)
  from public,anon,authenticated;
grant execute on function public.create_paper_equity_protective_order(uuid,uuid,text,text,text,bigint,integer)
  to authenticated;
