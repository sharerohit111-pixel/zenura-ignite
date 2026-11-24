-- Disposable PostgreSQL smoke test for the distributed provider quota RPC.
DO $quota_smoke$
DECLARE
  v_one jsonb;
  v_two jsonb;
  v_denied jsonb;
  v_other_user jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.market_data_provider_quota_policies
     WHERE provider_id='quota-test' AND operation='quote'
  ) THEN
    RAISE EXCEPTION 'Quota smoke fixture unexpectedly already exists';
  END IF;

  INSERT INTO public.market_data_provider_quota_policies(
    provider_id,operation,provider_account_key,provider_capacity,provider_window_ms,
    user_capacity,user_window_ms,enabled
  ) VALUES ('quota-test','quote','quota-test-account',3,60000,2,60000,true);

  v_one := public.consume_market_data_provider_quota(
    'quota-test','quote','11111111-1111-4111-8111-111111111111',1
  );
  v_two := public.consume_market_data_provider_quota(
    'quota-test','quote','11111111-1111-4111-8111-111111111111',1
  );
  v_denied := public.consume_market_data_provider_quota(
    'quota-test','quote','11111111-1111-4111-8111-111111111111',1
  );
  v_other_user := public.consume_market_data_provider_quota(
    'quota-test','quote','22222222-2222-4222-8222-222222222222',1
  );

  IF (v_one->>'allowed')::boolean IS NOT TRUE
     OR (v_two->>'allowed')::boolean IS NOT TRUE
     OR (v_denied->>'allowed')::boolean IS NOT FALSE
     OR (v_denied->>'retry_after_ms')::bigint<=0
     OR (v_other_user->>'allowed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Per-user quota boundary or retry metadata failed: %, %, %, %',
      v_one,v_two,v_denied,v_other_user;
  END IF;

  -- The denied request must not consume the provider-account bucket.
  IF (v_other_user->>'provider_remaining')::integer<>0 THEN
    RAISE EXCEPTION 'Denied per-user request unexpectedly consumed provider quota';
  END IF;

  v_denied := public.consume_market_data_provider_quota(
    'quota-test','quote','33333333-3333-4333-8333-333333333333',1
  );
  IF (v_denied->>'allowed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Provider-account global quota was not enforced';
  END IF;

  BEGIN
    PERFORM public.consume_market_data_provider_quota(
      'quota-missing','quote','11111111-1111-4111-8111-111111111111',1
    );
    RAISE EXCEPTION 'Missing provider policy unexpectedly allowed a request';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;

  DELETE FROM public.market_data_provider_quota_policies
   WHERE provider_id='quota-test' AND operation='quote';
END
$quota_smoke$;
