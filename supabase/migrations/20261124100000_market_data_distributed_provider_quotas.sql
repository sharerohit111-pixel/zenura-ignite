-- Distributed provider API quota enforcement for horizontally scaled market gateways.
-- Policy rows are deliberately not seeded: provider-specific contractual limits must be
-- configured only after the provider account, plan and current terms are verified.

create table if not exists public.market_data_provider_quota_policies (
  provider_id text not null check (provider_id ~ '^[a-z][a-z0-9_-]{1,39}$'),
  operation text not null check (operation ~ '^[a-z][a-z0-9_-]{1,39}$'),
  provider_account_key text not null check (length(btrim(provider_account_key)) between 1 and 120),
  provider_capacity integer not null check (provider_capacity between 1 and 10000000),
  provider_window_ms integer not null check (provider_window_ms between 100 and 86400000),
  user_capacity integer not null check (user_capacity between 1 and 1000000),
  user_window_ms integer not null check (user_window_ms between 100 and 86400000),
  enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (provider_id, operation)
);

create table if not exists public.market_data_provider_quota_buckets (
  provider_id text not null,
  operation text not null,
  quota_scope text not null check (quota_scope in ('account','user')),
  scope_key text not null,
  window_start_ms bigint not null check (window_start_ms >= 0),
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (provider_id, operation, quota_scope, scope_key, window_start_ms),
  foreign key (provider_id, operation)
    references public.market_data_provider_quota_policies(provider_id, operation)
    on delete cascade
);

create index if not exists market_data_provider_quota_buckets_updated_idx
  on public.market_data_provider_quota_buckets(updated_at);

alter table public.market_data_provider_quota_policies enable row level security;
alter table public.market_data_provider_quota_buckets enable row level security;

revoke all on table public.market_data_provider_quota_policies from public, anon, authenticated;
revoke all on table public.market_data_provider_quota_buckets from public, anon, authenticated;
grant select, insert, update, delete on table public.market_data_provider_quota_policies to service_role;
grant select, insert, update, delete on table public.market_data_provider_quota_buckets to service_role;

create or replace function public.consume_market_data_provider_quota(
  p_provider_id text,
  p_operation text,
  p_user_id uuid,
  p_cost integer default 1
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.market_data_provider_quota_policies%rowtype;
  v_now_ms bigint;
  v_account_window_start bigint;
  v_user_window_start bigint;
  v_account_used integer;
  v_user_used integer;
  v_account_retry bigint := 0;
  v_user_retry bigint := 0;
begin
  if p_provider_id is null or p_provider_id !~ '^[a-z][a-z0-9_-]{1,39}$'
     or p_operation is null or p_operation !~ '^[a-z][a-z0-9_-]{1,39}$'
     or p_user_id is null
     or p_cost is null or p_cost not between 1 and 10000 then
    raise exception 'Invalid market-data quota request.' using errcode='22023';
  end if;

  select * into v_policy
    from public.market_data_provider_quota_policies
   where provider_id=p_provider_id and operation=p_operation and enabled is true
   for share;
  if not found then
    raise exception 'Market-data provider quota policy is not enabled.' using errcode='55000';
  end if;

  v_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_account_window_start := (v_now_ms / v_policy.provider_window_ms) * v_policy.provider_window_ms;
  v_user_window_start := (v_now_ms / v_policy.user_window_ms) * v_policy.user_window_ms;

  -- All calls lock the provider-account bucket before the user bucket, avoiding
  -- lock-order inversions. The function transaction makes both updates atomic.
  insert into public.market_data_provider_quota_buckets(
    provider_id,operation,quota_scope,scope_key,window_start_ms,used
  ) values (
    p_provider_id,p_operation,'account',v_policy.provider_account_key,v_account_window_start,0
  ) on conflict do nothing;

  select used into v_account_used
    from public.market_data_provider_quota_buckets
   where provider_id=p_provider_id and operation=p_operation
     and quota_scope='account' and scope_key=v_policy.provider_account_key
     and window_start_ms=v_account_window_start
   for update;

  insert into public.market_data_provider_quota_buckets(
    provider_id,operation,quota_scope,scope_key,window_start_ms,used
  ) values (
    p_provider_id,p_operation,'user',p_user_id::text,v_user_window_start,0
  ) on conflict do nothing;

  select used into v_user_used
    from public.market_data_provider_quota_buckets
   where provider_id=p_provider_id and operation=p_operation
     and quota_scope='user' and scope_key=p_user_id::text
     and window_start_ms=v_user_window_start
   for update;

  if v_account_used + p_cost > v_policy.provider_capacity then
    v_account_retry := greatest(1, v_policy.provider_window_ms - (v_now_ms-v_account_window_start));
  end if;
  if v_user_used + p_cost > v_policy.user_capacity then
    v_user_retry := greatest(1, v_policy.user_window_ms - (v_now_ms-v_user_window_start));
  end if;

  if v_account_retry > 0 or v_user_retry > 0 then
    return jsonb_build_object(
      'allowed',false,
      'retry_after_ms',greatest(v_account_retry,v_user_retry),
      'provider_remaining',greatest(0,v_policy.provider_capacity-v_account_used),
      'user_remaining',greatest(0,v_policy.user_capacity-v_user_used)
    );
  end if;

  update public.market_data_provider_quota_buckets
     set used=used+p_cost,updated_at=clock_timestamp()
   where provider_id=p_provider_id and operation=p_operation
     and quota_scope='account' and scope_key=v_policy.provider_account_key
     and window_start_ms=v_account_window_start;

  update public.market_data_provider_quota_buckets
     set used=used+p_cost,updated_at=clock_timestamp()
   where provider_id=p_provider_id and operation=p_operation
     and quota_scope='user' and scope_key=p_user_id::text
     and window_start_ms=v_user_window_start;

  return jsonb_build_object(
    'allowed',true,
    'retry_after_ms',0,
    'provider_remaining',v_policy.provider_capacity-v_account_used-p_cost,
    'user_remaining',v_policy.user_capacity-v_user_used-p_cost
  );
end;
$$;

revoke all on function public.consume_market_data_provider_quota(text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.consume_market_data_provider_quota(text,text,uuid,integer) to service_role;
