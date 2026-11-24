-- Preserve the original LIMIT opening reservation in the risk guard after
-- the fill RPC has transferred/released the per-order pending reservation.
create or replace function public._guard_paper_futures_risk_increase()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_instrument_key text;
  v_side text;
  v_order_type text;
  v_initial_reserved bigint:=0;
  v_fill_sequence integer:=0;
  v_allocated_margin bigint:=0;
  v_position public.paper_futures_positions%rowtype;
  v_risk public.paper_futures_risk_state%rowtype;
  v_now_ms bigint;
  v_is_margin_call boolean:=false;
  v_is_unknown boolean:=false;
begin
  if tg_table_name='paper_futures_orders' then
    v_user_id:=new.user_id;
    v_instrument_key:=new.instrument_key;
    v_side:=new.side;
    v_order_type:=new.order_type;
    v_initial_reserved:=case when new.order_type='MARKET'
      then coalesce(new.margin_reserved_paise,0)
      else coalesce(new.reserved_open_margin_paise,0) end;
  else
    select user_id,instrument_key,side,order_type,
      greatest(coalesce(reserved_open_margin_paise,0),coalesce(margin_reserved_paise,0))
      into v_user_id,v_instrument_key,v_side,v_order_type,v_initial_reserved
      from public.paper_futures_orders where order_id=new.order_id;
    if not found then
      raise exception 'Futures fill has no owning order.' using errcode='23503';
    end if;
    v_fill_sequence:=new.fill_sequence;
    v_allocated_margin:=coalesce(new.allocated_margin_paise,0);
  end if;

  select * into v_risk from public.paper_futures_risk_state
   where user_id=v_user_id and instrument_key=v_instrument_key;
  if not found or v_risk.risk_status='CLOSED' then return new; end if;

  v_now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_is_margin_call:=v_risk.risk_status='MARGIN_CALL';
  v_is_unknown:=v_risk.risk_status='UNKNOWN'
    or v_risk.source_timestamp_ms is null
    or v_now_ms-v_risk.source_timestamp_ms>900000;
  if not v_is_margin_call and not v_is_unknown then return new; end if;

  select * into v_position from public.paper_futures_positions
   where user_id=v_user_id and instrument_key=v_instrument_key;
  if not found then
    if tg_table_name='paper_futures_fills' then return new; end if;
    if v_order_type='MARKET' and v_initial_reserved=0 then return new; end if;
    if v_is_unknown and v_initial_reserved>0 then return new; end if;
    raise exception 'Futures margin state is UNKNOWN or in MARGIN_CALL; an unreserved opening order is blocked.'
      using errcode='55000';
  end if;

  if (v_position.net_quantity>0 and v_side='SELL')
     or (v_position.net_quantity<0 and v_side='BUY') then
    return new;
  end if;

  if v_is_unknown and not v_is_margin_call then
    if v_initial_reserved>0 then return new; end if;
    if tg_table_name='paper_futures_fills'
       and v_fill_sequence>1 and v_allocated_margin>0 then
      return new;
    end if;
  end if;

  raise exception 'Futures risk-increasing exposure is blocked by UNKNOWN/stale maintenance data or MARGIN_CALL.'
    using errcode='55000';
end;
$$;

revoke all on function public._guard_paper_futures_risk_increase() from public,anon,authenticated;
