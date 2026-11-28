-- S-TRADE: one-time, broker- and user-bound OAuth nonce storage.
-- The application signs state; this table enforces atomic single-use consumption.
create table if not exists public.broker_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  broker_name text not null check (broker_name in ('upstox','fyers')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint broker_oauth_state_expiry_check check (expires_at > created_at)
);

create index if not exists broker_oauth_states_expiry_idx
  on public.broker_oauth_states(expires_at);

alter table public.broker_oauth_states enable row level security;
alter table public.broker_oauth_states force row level security;
revoke all on public.broker_oauth_states from anon, authenticated;
grant select, insert, update, delete on public.broker_oauth_states to service_role;

create or replace function public.begin_broker_oauth_state(
  p_state_hash text, p_user_id uuid, p_broker_name text,
  p_expires_at timestamptz, p_now timestamptz default now()
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_state_hash !~ '^[a-f0-9]{64}$'
     or p_broker_name not in ('upstox','fyers')
     or p_expires_at <= p_now
     or p_expires_at > p_now + interval '10 minutes' then
    raise exception 'Invalid broker OAuth state parameters' using errcode = '22023';
  end if;
  -- Opportunistically prune expired or long-consumed nonces whenever a new flow starts.
  -- This keeps the server-only state table bounded without a separate scheduler.
  delete from public.broker_oauth_states
   where expires_at <= p_now
      or consumed_at <= p_now - interval '1 day';
  insert into public.broker_oauth_states(state_hash,user_id,broker_name,expires_at,created_at)
  values (p_state_hash,p_user_id,p_broker_name,p_expires_at,p_now);
  return true;
end;
$$;

create or replace function public.consume_broker_oauth_state(
  p_state_hash text, p_broker_name text, p_now timestamptz default now()
) returns table(user_id uuid)
language plpgsql security definer
set search_path = ''
as $$
begin
  return query
  update public.broker_oauth_states s
     set consumed_at = p_now
   where s.state_hash = p_state_hash
     and s.broker_name = p_broker_name
     and s.consumed_at is null
     and s.expires_at > p_now
  returning s.user_id;
end;
$$;

revoke all on function public.begin_broker_oauth_state(text,uuid,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.consume_broker_oauth_state(text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.begin_broker_oauth_state(text,uuid,text,timestamptz,timestamptz) to service_role;
grant execute on function public.consume_broker_oauth_state(text,text,timestamptz) to service_role;
