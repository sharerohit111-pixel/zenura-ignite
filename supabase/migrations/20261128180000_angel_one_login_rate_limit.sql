-- Distributed per-user Angel One login limiter (shared across gateway instances).
create table if not exists public.angel_one_login_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists angel_one_login_attempts_user_time_idx
  on public.angel_one_login_attempts(user_id, attempted_at desc);
alter table public.angel_one_login_attempts enable row level security;
alter table public.angel_one_login_attempts force row level security;
revoke all on public.angel_one_login_attempts from public, anon, authenticated;
grant select, insert, delete on public.angel_one_login_attempts to service_role;

create or replace function public.reserve_angel_one_login_attempt(
  p_user_id uuid, p_now timestamptz default now()
) returns table(allowed boolean, retry_after_seconds integer)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_last timestamptz;
  v_oldest timestamptz;
begin
  if p_user_id is null then
    raise exception 'user id required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  delete from public.angel_one_login_attempts
   where user_id = p_user_id and attempted_at < p_now - interval '15 minutes';
  select count(*), max(attempted_at), min(attempted_at)
    into v_count, v_last, v_oldest
    from public.angel_one_login_attempts
   where user_id = p_user_id;
  if v_last is not null and v_last > p_now - interval '1 second' then
    return query select false, greatest(1, ceil(extract(epoch from (v_last + interval '1 second' - p_now)))::integer);
    return;
  end if;
  if v_count >= 5 then
    return query select false, greatest(1, ceil(extract(epoch from (v_oldest + interval '15 minutes' - p_now)))::integer);
    return;
  end if;
  insert into public.angel_one_login_attempts(user_id, attempted_at) values (p_user_id, p_now);
  return query select true, 0;
end;
$$;
revoke all on function public.reserve_angel_one_login_attempt(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.reserve_angel_one_login_attempt(uuid,timestamptz) to service_role;
