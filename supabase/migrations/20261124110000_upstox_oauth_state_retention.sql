-- Bound retention of expired Upstox OAuth state records.
-- Cleanup runs lazily on authorization start and is capped per invocation.
create index if not exists upstox_oauth_states_expires_at_idx
  on public.upstox_oauth_states(expires_at);

create or replace function public.begin_upstox_oauth(
  p_user_id uuid,p_state_hash text,p_expires_at timestamptz,p_now_ms bigint
) returns bigint
language plpgsql security definer set search_path=''
as $$
declare v_generation bigint;
begin
  if p_user_id is null or p_state_hash is null or p_state_hash !~ '^[a-f0-9]{64}$'
     or p_expires_at is null or p_now_ms is null or p_now_ms<0
     or p_expires_at<=clock_timestamp()
     or p_expires_at>clock_timestamp()+interval '10 minutes' then
    raise exception 'Invalid Upstox OAuth state request' using errcode='22023';
  end if;

  -- Retain expired states for one day for short-lived operational/audit needs,
  -- then prune at most 500 per authorization start to bound each request's work.
  WITH stale AS MATERIALIZED (
    SELECT state_hash
      FROM public.upstox_oauth_states
     WHERE expires_at < clock_timestamp()-interval '1 day'
     ORDER BY expires_at
     LIMIT 500
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.upstox_oauth_states AS states
   USING stale
   WHERE states.state_hash=stale.state_hash;

  insert into public.upstox_connection_controls(user_id,generation,updated_at_ms)
  values(p_user_id,0,p_now_ms)
  on conflict(user_id) do update set updated_at_ms=excluded.updated_at_ms;
  select generation into v_generation from public.upstox_connection_controls
   where user_id=p_user_id for update;
  insert into public.upstox_oauth_states(state_hash,user_id,connection_generation,used,expires_at)
  values(p_state_hash,p_user_id,v_generation,false,p_expires_at);
  return v_generation;
end;
$$;

revoke all on function public.begin_upstox_oauth(uuid,text,timestamptz,bigint) from public,anon,authenticated;
grant execute on function public.begin_upstox_oauth(uuid,text,timestamptz,bigint) to service_role;
