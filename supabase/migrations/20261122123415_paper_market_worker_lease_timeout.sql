-- Allow a 240-second in-service worker lease while retaining a strict five-minute maximum.
create or replace function public.acquire_paper_market_worker_lease(
  p_state_key text,p_lease_token uuid,p_now_ms bigint,p_ttl_ms bigint
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_token uuid;
begin
  if p_state_key is null or p_state_key not in ('paper_limit_orders','paper_protective_orders')
     or p_lease_token is null or p_now_ms is null or p_now_ms<0
     or p_ttl_ms is null or p_ttl_ms not between 5000 and 300000 then
    raise exception 'Invalid paper market worker lease request' using errcode='22023';
  end if;
  insert into public.paper_market_worker_state(
    state_key,cursor_order_id,cursor_created_at,lease_token,lease_expires_at,updated_at
  ) values(
    p_state_key,null,null,p_lease_token,
    to_timestamp((p_now_ms+p_ttl_ms)::double precision/1000.0),
    clock_timestamp()
  )
  on conflict(state_key) do update set
    lease_token=excluded.lease_token,
    lease_expires_at=excluded.lease_expires_at,
    updated_at=clock_timestamp()
  where public.paper_market_worker_state.lease_token is null
     or public.paper_market_worker_state.lease_expires_at is null
     or public.paper_market_worker_state.lease_expires_at<=to_timestamp(p_now_ms::double precision/1000.0)
  returning lease_token into v_token;
  return coalesce(v_token=p_lease_token,false);
end;
$$;
revoke all on function public.acquire_paper_market_worker_lease(text,uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.acquire_paper_market_worker_lease(text,uuid,bigint,bigint) to service_role;
