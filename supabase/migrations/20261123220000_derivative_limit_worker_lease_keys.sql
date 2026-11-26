-- Register isolated Futures and Options LIMIT worker lease keys.
-- Existing equity Delivery, Intraday and protective lease behavior is preserved.

create or replace function public.acquire_paper_market_worker_lease(
  p_state_key text,p_lease_token uuid,p_now_ms bigint,p_ttl_ms bigint
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_token uuid;
begin
  if p_state_key is null
     or p_state_key not in (
       'paper_limit_orders','paper_protective_orders','paper_intraday_limit_orders',
       'paper_futures_limit_orders','paper_option_limit_orders'
     )
     or p_lease_token is null or p_now_ms is null or p_now_ms<0
     or p_now_ms>9007199254740991
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

create or replace function public.release_paper_market_worker_lease(
  p_state_key text,p_lease_token uuid,p_now_ms bigint
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_rows integer;
begin
  if p_state_key is null
     or p_state_key not in (
       'paper_limit_orders','paper_protective_orders','paper_intraday_limit_orders',
       'paper_futures_limit_orders','paper_option_limit_orders'
     )
     or p_lease_token is null or p_now_ms is null or p_now_ms<0
     or p_now_ms>9007199254740991 then
    raise exception 'Invalid paper market worker lease release' using errcode='22023';
  end if;
  update public.paper_market_worker_state
     set lease_token=null,lease_expires_at=null,updated_at=clock_timestamp()
   where state_key=p_state_key and lease_token=p_lease_token;
  get diagnostics v_rows=row_count;
  return v_rows=1;
end;
$$;

revoke all on function public.acquire_paper_market_worker_lease(text,uuid,bigint,bigint)
  from public,anon,authenticated;
revoke all on function public.release_paper_market_worker_lease(text,uuid,bigint)
  from public,anon,authenticated;
grant execute on function public.acquire_paper_market_worker_lease(text,uuid,bigint,bigint)
  to service_role;
grant execute on function public.release_paper_market_worker_lease(text,uuid,bigint)
  to service_role;
