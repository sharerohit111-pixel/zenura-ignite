-- Extend owner-bound leases without allowing an expired/stale owner to resurrect them.
-- Shared by isolated equity, intraday, protective, Futures and Options workers.

create or replace function public.renew_paper_market_worker_lease(
  p_state_key text,p_lease_token uuid,p_now_ms bigint,p_ttl_ms bigint
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
     or p_now_ms>9007199254740991
     or p_ttl_ms is null or p_ttl_ms not between 5000 and 300000 then
    raise exception 'Invalid paper market worker lease renewal' using errcode='22023';
  end if;

  update public.paper_market_worker_state
     set lease_expires_at=to_timestamp((p_now_ms+p_ttl_ms)::double precision/1000.0),
         updated_at=clock_timestamp()
   where state_key=p_state_key
     and lease_token=p_lease_token
     and lease_expires_at>to_timestamp(p_now_ms::double precision/1000.0);
  get diagnostics v_rows=row_count;
  return v_rows=1;
end;
$$;

revoke all on function public.renew_paper_market_worker_lease(text,uuid,bigint,bigint)
  from public,anon,authenticated;
grant execute on function public.renew_paper_market_worker_lease(text,uuid,bigint,bigint)
  to service_role;

comment on function public.renew_paper_market_worker_lease(text,uuid,bigint,bigint) is
  'Service-role-only renewal for active paper market worker leases. Expired or non-owner tokens cannot renew.';
