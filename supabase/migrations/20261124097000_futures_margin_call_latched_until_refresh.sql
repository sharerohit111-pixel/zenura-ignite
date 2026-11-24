-- A reducing order must not clear an existing MARGIN_CALL. Keep the call
-- latched until a fresh provider margin refresh explicitly resolves it.
create or replace function public._seed_paper_futures_unknown_risk_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_instrument_key text;
  v_position public.paper_futures_positions%rowtype;
begin
  if tg_table_name='paper_futures_orders' then
    v_user_id:=new.user_id;
    v_instrument_key:=new.instrument_key;
    select * into v_position from public.paper_futures_positions
     where user_id=v_user_id and instrument_key=v_instrument_key;
    if not found and new.order_type='LIMIT' then return new; end if;
    if not found and new.order_type='MARKET' then
      insert into public.paper_futures_risk_state(
        user_id,instrument_key,initial_margin_paise,maintenance_margin_paise,
        risk_status,snapshot_version,updated_at
      ) values (v_user_id,v_instrument_key,0,null,'CLOSED',1,now())
      on conflict(user_id,instrument_key) do update set
        initial_margin_paise=0,maintenance_margin_paise=null,risk_status='CLOSED',
        provider=null,source_reference=null,source_sha256=null,source_timestamp_ms=null,
        snapshot_version=public.paper_futures_risk_state.snapshot_version+1,updated_at=now();
      return new;
    end if;
  else
    select user_id,instrument_key into v_user_id,v_instrument_key
      from public.paper_futures_orders where order_id=new.order_id;
    if not found then return new; end if;
    select * into v_position from public.paper_futures_positions
     where user_id=v_user_id and instrument_key=v_instrument_key;
    if not found then
      update public.paper_futures_risk_state set risk_status='CLOSED',updated_at=now()
       where user_id=v_user_id and instrument_key=v_instrument_key;
      return new;
    end if;
  end if;

  insert into public.paper_futures_risk_state(
    user_id,instrument_key,initial_margin_paise,maintenance_margin_paise,
    risk_status,snapshot_version,updated_at
  ) values (
    v_user_id,v_instrument_key,v_position.reserved_margin_paise,null,'UNKNOWN',1,now()
  ) on conflict(user_id,instrument_key) do update set
    initial_margin_paise=excluded.initial_margin_paise,
    maintenance_margin_paise=case
      when public.paper_futures_risk_state.risk_status='MARGIN_CALL'
        then public.paper_futures_risk_state.maintenance_margin_paise
      else null end,
    risk_status=case
      when public.paper_futures_risk_state.risk_status='MARGIN_CALL'
        then 'MARGIN_CALL' else 'UNKNOWN' end,
    provider=case when public.paper_futures_risk_state.risk_status='MARGIN_CALL'
      then public.paper_futures_risk_state.provider else null end,
    source_reference=case when public.paper_futures_risk_state.risk_status='MARGIN_CALL'
      then public.paper_futures_risk_state.source_reference else null end,
    source_sha256=case when public.paper_futures_risk_state.risk_status='MARGIN_CALL'
      then public.paper_futures_risk_state.source_sha256 else null end,
    source_timestamp_ms=case when public.paper_futures_risk_state.risk_status='MARGIN_CALL'
      then public.paper_futures_risk_state.source_timestamp_ms else null end,
    snapshot_version=public.paper_futures_risk_state.snapshot_version+1,updated_at=now();
  return new;
end;
$$;

revoke all on function public._seed_paper_futures_unknown_risk_state() from public,anon,authenticated;
