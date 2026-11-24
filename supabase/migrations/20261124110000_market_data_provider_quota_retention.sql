-- Bounded retention maintenance for expired distributed provider quota buckets.
-- The caller must choose a cutoff at least 24 hours in the past. Current and
-- recently closed windows cannot be deleted by this function.
create or replace function public.prune_market_data_provider_quota_buckets(
  p_before_ms bigint,
  p_batch_size integer default 5000
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now_ms bigint;
  v_cutoff timestamptz;
  v_deleted integer;
begin
  if p_before_ms is null or p_before_ms < 0
     or p_batch_size is null or p_batch_size not between 1 and 10000 then
    raise exception 'Invalid provider quota retention request.' using errcode='22023';
  end if;

  v_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  if p_before_ms > v_now_ms - 86400000 then
    raise exception 'Provider quota retention cutoff must be at least 24 hours old.' using errcode='22023';
  end if;
  v_cutoff := to_timestamp(p_before_ms::numeric / 1000);

  with expired as (
    select ctid
      from public.market_data_provider_quota_buckets
     where window_start_ms < p_before_ms
       and updated_at < v_cutoff
     order by updated_at asc
     limit p_batch_size
     for update skip locked
  )
  delete from public.market_data_provider_quota_buckets b
   using expired e
   where b.ctid=e.ctid;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_market_data_provider_quota_buckets(bigint,integer) from public,anon,authenticated;
grant execute on function public.prune_market_data_provider_quota_buckets(bigint,integer) to service_role;
