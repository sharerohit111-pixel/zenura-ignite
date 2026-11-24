-- Allow already-accepted, margin-reserved partial LIMIT orders to finish
-- their remaining fills while risk state is UNKNOWN. A new order/fill (sequence 1)
-- remains blocked; MARGIN_CALL always blocks additional opening fills.
create or replace function public._guard_paper_futures_risk_increase()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_instrument_key text;
  v_side text;
  v_order_filled integer:=0;
  v_position public.paper_futures_positions%rowtype;
  v_risk public.paper_futures_risk_state%rowtype;
  v_now_ms bigint;
begin
  if tg_table_name='paper_futures_orders' then
    v_user_id:=new.user_id;
    v_instrument_key:=new.instrument_key;
    v_side:=new.side;
  else
    select user_id,instrument_key,side,filled_quantity
      into v_user_id,v_instrument_key,v_side,v_order_filled
      from public.paper_futures_orders where order_id=new.order_id;
    if not found then
      raise exception 'Futures fill has no owning order.' using errcode='23503';
    end if;
  end if;

  select * into v_risk from public.paper_futures_risk_state
   where user_id=v_user_id and instrument_key=v_instrument_key;
  if not found or v_risk.risk_status='CLOSED' then return new; end if;

  v_now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if v_risk.risk_status='HEALTHY'
     and v_risk.source_timestamp_ms is not null
     and v_now_ms-v_risk.source_timestamp_ms<=900000 then
    return new;
  end if;

  select * into v_position from public.paper_futures_positions
   where user_id=v_user_id and instrument_key=v_instrument_key;
  if not found then
    if tg_table_name='paper_futures_orders' and new.order_type='MARKET' then return new; end if;
    if tg_table_name='paper_futures_fills' then return new; end if;
    raise exception 'Futures margin snapshot is UNKNOWN, stale or in margin call; opening exposure is blocked.'
      using errcode='55000';
  end if;

  -- A fill sequence > 1 is a continuation of the same previously accepted
  -- LIMIT order. Its opening margin was already reserved at submit time.
  if v_risk.risk_status='UNKNOWN'
     and tg_table_name='paper_futures_fills'
     and new.fill_sequence>1
     and new.allocated_margin_paise>0
     and ((v_position.net_quantity>0 and v_side='BUY')
       or (v_position.net_quantity<0 and v_side='SELL')) then
    return new;
  end if;

  if (v_position.net_quantity>0 and v_side='SELL')
     or (v_position.net_quantity<0 and v_side='BUY') then
    return new;
  end if;
  raise exception 'Futures margin snapshot is UNKNOWN, stale or in margin call; risk-increasing exposure is blocked.'
    using errcode='55000';
end;
$$;

revoke all on function public._guard_paper_futures_risk_increase() from public,anon,authenticated;
