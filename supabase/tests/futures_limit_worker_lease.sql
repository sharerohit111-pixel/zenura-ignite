-- Disposable PostgreSQL regression for isolated NSE Futures LIMIT worker leases.
BEGIN;
DO $futures_worker_lease$
DECLARE
  v_now bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_owner uuid:='f1111111-1111-4111-8111-111111111111';
  v_other uuid:='f2222222-2222-4222-8222-222222222222';
  v_acquired boolean;
  v_rejected boolean;
BEGIN
  v_acquired:=public.acquire_paper_market_worker_lease(
    'paper_futures_limit_orders',v_owner,v_now,240000
  );
  IF v_acquired IS NOT TRUE THEN
    RAISE EXCEPTION 'Futures LIMIT worker could not acquire its dedicated lease';
  END IF;

  v_acquired:=public.acquire_paper_market_worker_lease(
    'paper_futures_limit_orders',v_other,v_now+1,240000
  );
  IF v_acquired IS NOT FALSE THEN
    RAISE EXCEPTION 'A second Futures LIMIT worker acquired an active lease';
  END IF;

  IF public.release_paper_market_worker_lease(
    'paper_futures_limit_orders',v_other,v_now+2
  ) IS NOT FALSE THEN
    RAISE EXCEPTION 'A non-owner Futures LIMIT worker released another lease';
  END IF;

  IF public.release_paper_market_worker_lease(
    'paper_futures_limit_orders',v_owner,v_now+3
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Futures LIMIT lease owner could not release its lease';
  END IF;

  IF public.release_paper_market_worker_lease(
    'paper_futures_limit_orders',v_owner,v_now+4
  ) IS NOT FALSE THEN
    RAISE EXCEPTION 'Repeated Futures LIMIT lease release was not idempotent';
  END IF;

  IF public.acquire_paper_market_worker_lease(
    'paper_futures_limit_orders',v_other,v_now+5,240000
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Futures LIMIT lease was not reusable after owner release';
  END IF;
  PERFORM public.release_paper_market_worker_lease(
    'paper_futures_limit_orders',v_other,v_now+6
  );

  -- Existing equity/intraday/protective namespaces must remain usable.
  FOREACH v_acquired IN ARRAY ARRAY[
    public.acquire_paper_market_worker_lease('paper_limit_orders',v_owner,v_now+10,120000),
    public.acquire_paper_market_worker_lease('paper_intraday_limit_orders',v_owner,v_now+11,120000),
    public.acquire_paper_market_worker_lease('paper_protective_orders',v_owner,v_now+12,120000)
  ] LOOP
    IF v_acquired IS NOT TRUE THEN
      RAISE EXCEPTION 'An existing paper market worker lease key regressed';
    END IF;
  END LOOP;
  PERFORM public.release_paper_market_worker_lease('paper_limit_orders',v_owner,v_now+13);
  PERFORM public.release_paper_market_worker_lease('paper_intraday_limit_orders',v_owner,v_now+14);
  PERFORM public.release_paper_market_worker_lease('paper_protective_orders',v_owner,v_now+15);

  v_rejected:=false;
  BEGIN
    PERFORM public.acquire_paper_market_worker_lease(
      'paper_futures_limit_orders',v_owner,9007199254740992,5000
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected:=true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Unsafe Futures worker timestamp was accepted';
  END IF;

  IF has_function_privilege('anon',
       'public.acquire_paper_market_worker_lease(text,uuid,bigint,bigint)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.release_paper_market_worker_lease(text,uuid,bigint)','EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.acquire_paper_market_worker_lease(text,uuid,bigint,bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'Worker lease RPC grants are not service-role-only';
  END IF;
END
$futures_worker_lease$;
ROLLBACK;
