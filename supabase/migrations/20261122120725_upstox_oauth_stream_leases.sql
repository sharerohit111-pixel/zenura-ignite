-- Supabase-native Upstox OAuth state, connection generation, stream lease and rate-limit RPCs.
-- All functions are service-role-only; the gateway passes only a server-verified auth.users UUID.
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

create or replace function public.consume_upstox_oauth_state(p_state_hash text,p_now_ms bigint)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_state public.upstox_oauth_states%rowtype;
begin
  if p_state_hash is null or p_state_hash !~ '^[a-f0-9]{64}$' or p_now_ms is null or p_now_ms<0 then
    raise exception 'Invalid Upstox OAuth state' using errcode='22023';
  end if;
  update public.upstox_oauth_states
     set used=true,used_at=clock_timestamp()
   where state_hash=p_state_hash and used=false
     and expires_at>clock_timestamp()
   returning * into v_state;
  if not found then return null; end if;
  return jsonb_build_object(
    'user_id',v_state.user_id,
    'connection_generation',v_state.connection_generation,
    'expires_at',v_state.expires_at
  );
end;
$$;

create or replace function public.save_upstox_connection(
  p_user_id uuid,p_generation bigint,p_token_ciphertext jsonb,p_token_type text,
  p_token_expires_at timestamptz,p_token_issued_at timestamptz,p_scopes text[],p_now_ms bigint
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_generation bigint;
begin
  if p_user_id is null or p_generation is null or p_generation<0
     or p_token_ciphertext is null
     or jsonb_typeof(p_token_ciphertext)<>'object'
     or p_token_ciphertext->>'v'<>'1'
     or p_token_type is null or length(p_token_type)>30
     or p_token_expires_at is null or p_token_expires_at<=clock_timestamp()
     or p_now_ms is null or p_now_ms<0 then
    raise exception 'Invalid encrypted Upstox connection data' using errcode='22023';
  end if;
  select generation into v_generation from public.upstox_connection_controls
   where user_id=p_user_id for update;
  if not found or v_generation<>p_generation then return false; end if;
  insert into public.upstox_connections(
    user_id,status,token_ciphertext,token_type,provider,token_expires_at,
    token_issued_at,authorized_at,scopes,metadata,created_at,updated_at
  ) values(
    p_user_id,'connected',p_token_ciphertext,p_token_type,'upstox',p_token_expires_at,
    p_token_issued_at,clock_timestamp(),coalesce(p_scopes,'{}'::text[]),'{}'::jsonb,
    clock_timestamp(),clock_timestamp()
  )
  on conflict(user_id) do update set
    status='connected',token_ciphertext=excluded.token_ciphertext,
    token_type=excluded.token_type,token_expires_at=excluded.token_expires_at,
    token_issued_at=excluded.token_issued_at,authorized_at=excluded.authorized_at,
    scopes=excluded.scopes,metadata='{}'::jsonb,updated_at=clock_timestamp();
  return true;
end;
$$;

create or replace function public.disconnect_upstox_connection(p_user_id uuid,p_now_ms bigint)
returns bigint
language plpgsql security definer set search_path=''
as $$
declare v_generation bigint;
begin
  if p_user_id is null or p_now_ms is null or p_now_ms<0 then
    raise exception 'Invalid Upstox disconnect request' using errcode='22023';
  end if;
  insert into public.upstox_connection_controls(user_id,generation,updated_at_ms)
  values(p_user_id,1,p_now_ms)
  on conflict(user_id) do update
    set generation=public.upstox_connection_controls.generation+1,
        updated_at_ms=excluded.updated_at_ms
  returning generation into v_generation;
  delete from public.upstox_connections where user_id=p_user_id;
  update public.paper_market_stream_leases
     set revoked=true,expires_at_ms=p_now_ms,updated_at_ms=p_now_ms
   where user_id=p_user_id;
  return v_generation;
end;
$$;

create or replace function public.acquire_paper_market_stream_lease(
  p_user_id uuid,p_lease_id uuid,p_now_ms bigint,p_ttl_ms bigint
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_lease uuid;
begin
  if p_user_id is null or p_lease_id is null or p_now_ms is null or p_now_ms<0
     or p_ttl_ms is null or p_ttl_ms not between 5000 and 120000 then
    raise exception 'Invalid market stream lease request' using errcode='22023';
  end if;
  insert into public.paper_market_stream_leases(user_id,lease_id,expires_at_ms,updated_at_ms,revoked)
  values(p_user_id,p_lease_id,p_now_ms+p_ttl_ms,p_now_ms,false)
  on conflict(user_id) do update set
    lease_id=excluded.lease_id,expires_at_ms=excluded.expires_at_ms,
    updated_at_ms=excluded.updated_at_ms,revoked=false
  where public.paper_market_stream_leases.revoked=true
     or public.paper_market_stream_leases.expires_at_ms<=p_now_ms
  returning lease_id into v_lease;
  return coalesce(v_lease=p_lease_id,false);
end;
$$;

create or replace function public.renew_paper_market_stream_lease(
  p_user_id uuid,p_lease_id uuid,p_now_ms bigint,p_ttl_ms bigint
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_rows integer;
begin
  if p_user_id is null or p_lease_id is null or p_now_ms is null or p_now_ms<0
     or p_ttl_ms is null or p_ttl_ms not between 5000 and 120000 then
    raise exception 'Invalid market stream lease renewal' using errcode='22023';
  end if;
  update public.paper_market_stream_leases
     set expires_at_ms=p_now_ms+p_ttl_ms,updated_at_ms=p_now_ms
   where user_id=p_user_id and lease_id=p_lease_id
     and revoked=false and expires_at_ms>p_now_ms;
  get diagnostics v_rows=row_count;
  return v_rows=1;
end;
$$;

create or replace function public.release_paper_market_stream_lease(
  p_user_id uuid,p_lease_id uuid,p_now_ms bigint
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_rows integer;
begin
  if p_user_id is null or p_lease_id is null or p_now_ms is null or p_now_ms<0 then
    raise exception 'Invalid market stream lease release' using errcode='22023';
  end if;
  update public.paper_market_stream_leases
     set revoked=true,expires_at_ms=p_now_ms,updated_at_ms=p_now_ms
   where user_id=p_user_id and lease_id=p_lease_id and revoked=false;
  get diagnostics v_rows=row_count;
  return v_rows=1;
end;
$$;

create or replace function public.consume_paper_margin_preview_slot(
  p_user_id uuid,p_now_ms bigint,p_min_interval_ms bigint
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_rows integer;
begin
  if p_user_id is null or p_now_ms is null or p_now_ms<0
     or p_min_interval_ms is null or p_min_interval_ms not between 1000 and 60000 then
    raise exception 'Invalid margin preview rate-limit request' using errcode='22023';
  end if;
  insert into public.paper_margin_preview_limits(user_id,last_requested_at_ms,updated_at_ms)
  values(p_user_id,p_now_ms,p_now_ms)
  on conflict(user_id) do update set
    last_requested_at_ms=excluded.last_requested_at_ms,
    updated_at_ms=excluded.updated_at_ms
  where public.paper_margin_preview_limits.last_requested_at_ms<=p_now_ms-p_min_interval_ms;
  get diagnostics v_rows=row_count;
  return v_rows=1;
end;
$$;

revoke all on function public.begin_upstox_oauth(uuid,text,timestamptz,bigint) from public,anon,authenticated;
revoke all on function public.consume_upstox_oauth_state(text,bigint) from public,anon,authenticated;
revoke all on function public.save_upstox_connection(uuid,bigint,jsonb,text,timestamptz,timestamptz,text[],bigint) from public,anon,authenticated;
revoke all on function public.disconnect_upstox_connection(uuid,bigint) from public,anon,authenticated;
revoke all on function public.acquire_paper_market_stream_lease(uuid,uuid,bigint,bigint) from public,anon,authenticated;
revoke all on function public.renew_paper_market_stream_lease(uuid,uuid,bigint,bigint) from public,anon,authenticated;
revoke all on function public.release_paper_market_stream_lease(uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.consume_paper_margin_preview_slot(uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.begin_upstox_oauth(uuid,text,timestamptz,bigint) to service_role;
grant execute on function public.consume_upstox_oauth_state(text,bigint) to service_role;
grant execute on function public.save_upstox_connection(uuid,bigint,jsonb,text,timestamptz,timestamptz,text[],bigint) to service_role;
grant execute on function public.disconnect_upstox_connection(uuid,bigint) to service_role;
grant execute on function public.acquire_paper_market_stream_lease(uuid,uuid,bigint,bigint) to service_role;
grant execute on function public.renew_paper_market_stream_lease(uuid,uuid,bigint,bigint) to service_role;
grant execute on function public.release_paper_market_stream_lease(uuid,uuid,bigint) to service_role;
grant execute on function public.consume_paper_margin_preview_slot(uuid,bigint,bigint) to service_role;
