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

-- Reject malformed lease requests, including TTL values outside the
-- database-enforced 5s..120s window. Invalid requests must not mutate state.
do $$
declare
  v_bad_ttl bigint;
  v_failed boolean;
  v_token uuid := '33333333-3333-4333-8333-333333333333';
begin
  foreach v_bad_ttl in array array[4999::bigint,120001::bigint,-1::bigint] loop
    v_failed:=false;
    begin
      perform public.acquire_paper_crypto_limit_worker_lease(v_token,2000000,v_bad_ttl);
    exception when invalid_parameter_value then
      v_failed:=true;
    end;
    if not v_failed then
      raise exception 'Worker lease must reject invalid TTL %',v_bad_ttl;
    end if;
  end loop;

  v_failed:=false;
  begin
    perform public.acquire_paper_crypto_limit_worker_lease(v_token,-1,5000);
  exception when invalid_parameter_value then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'Worker lease must reject negative timestamps';
  end if;

  v_failed:=false;
  begin
    perform public.release_paper_crypto_limit_worker_lease(null,2000000);
  exception when invalid_parameter_value then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'Worker lease release must reject a null token';
  end if;

  if not public.acquire_paper_crypto_limit_worker_lease(v_token,2000000,5000) then
    raise exception 'Worker lease must accept the minimum supported TTL';
  end if;
  if not public.release_paper_crypto_limit_worker_lease(v_token,2001000) then
    raise exception 'Minimum-TTL worker lease cleanup failed';
  end if;
end;
$$;
