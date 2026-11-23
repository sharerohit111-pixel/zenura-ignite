-- Disposable PostgreSQL regression for owner-bound paper market worker lease renewal.
BEGIN;
DO $worker_lease_renewal$
DECLARE
  v_now bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_owner uuid:='a1111111-1111-4111-8111-111111111111';
  v_other uuid:='a2222222-2222-4222-8222-222222222222';
  v_renewed boolean;
  v_expiry_before timestamptz;
  v_expiry_after timestamptz;
  v_rejected boolean:=false;
BEGIN
  IF public.acquire_paper_market_worker_lease(
    'paper_futures_limit_orders',v_owner,v_now,30000
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Could not acquire Futures worker lease for renewal test';
  END IF;

  SELECT lease_expires_at INTO v_expiry_before
    FROM public.paper_market_worker_state
   WHERE state_key='paper_futures_limit_orders';

  IF public.renew_paper_market_worker_lease(
    'paper_futures_limit_orders',v_other,v_now+1000,120000
  ) IS NOT FALSE THEN
    RAISE EXCEPTION 'Non-owner renewed another worker lease';
  END IF;

  v_renewed:=public.renew_paper_market_worker_lease(
    'paper_futures_limit_orders',v_owner,v_now+1000,120000
  );
  IF v_renewed IS NOT TRUE THEN
    RAISE EXCEPTION 'Active owner could not renew Futures worker lease';
  END IF;

  SELECT lease_expires_at INTO v_expiry_after
    FROM public.paper_market_worker_state
   WHERE state_key='paper_futures_limit_orders';
  IF v_expiry_after<=v_expiry_before THEN
    RAISE EXCEPTION 'Futures worker lease expiry did not advance';
  END IF;

  IF public.renew_paper_market_worker_lease(
    'paper_futures_limit_orders',v_owner,v_now+300000,120000
  ) IS NOT FALSE THEN
    RAISE EXCEPTION 'Expired owner token resurrected a lease';
  END IF;

  v_rejected:=false;
  BEGIN
    PERFORM public.renew_paper_market_worker_lease(
      'paper_futures_limit_orders',v_owner,9007199254740992,120000
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected:=true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Unsafe renewal timestamp was accepted';
  END IF;

  IF has_function_privilege('anon',
       'public.renew_paper_market_worker_lease(text,uuid,bigint,bigint)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.renew_paper_market_worker_lease(text,uuid,bigint,bigint)','EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.renew_paper_market_worker_lease(text,uuid,bigint,bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'Lease renewal RPC grants are not service-role-only';
  END IF;

  PERFORM public.release_paper_market_worker_lease(
    'paper_futures_limit_orders',v_owner,v_now+300001
  );
END
$worker_lease_renewal$;
ROLLBACK;
