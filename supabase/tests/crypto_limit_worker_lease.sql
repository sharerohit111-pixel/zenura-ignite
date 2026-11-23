\set ON_ERROR_STOP on
-- Verify lease exclusivity, expiry takeover, and stale-token release protection.
set role service_role;
do $$
declare
  v_first uuid := '11111111-1111-4111-8111-111111111111';
  v_second uuid := '22222222-2222-4222-8222-222222222222';
begin
  if not public.acquire_paper_crypto_limit_worker_lease(v_first, 1000000, 120000) then
    raise exception 'First worker should acquire an unclaimed lease';
  end if;
  if public.acquire_paper_crypto_limit_worker_lease(v_second, 1050000, 120000) then
    raise exception 'Second worker must not acquire an unexpired lease';
  end if;
  if not public.acquire_paper_crypto_limit_worker_lease(v_second, 1121000, 120000) then
    raise exception 'Second worker should take over an expired lease';
  end if;
  if public.release_paper_crypto_limit_worker_lease(v_first, 1122000) then
    raise exception 'Stale worker token must not release the current lease';
  end if;
  if not public.release_paper_crypto_limit_worker_lease(v_second, 1122000) then
    raise exception 'Current worker should release its lease';
  end if;
  if public.acquire_paper_crypto_limit_worker_lease(v_first, 1123000, 120000) is not true then
    raise exception 'Lease should be reusable after release';
  end if;
  if not public.release_paper_crypto_limit_worker_lease(v_first, 1124000) then
    raise exception 'Final worker lease cleanup failed';
  end if;
end;
$$;
reset role;
