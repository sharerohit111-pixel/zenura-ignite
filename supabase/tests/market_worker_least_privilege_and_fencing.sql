-- Draft regression contract for the direct serviceDb worker ACLs and lease fencing.
-- Run only in disposable PostgreSQL after the complete canonical migration set.
-- This test is intentionally not wired into CI until the draft ACL migrations are reconciled.
-- It is expected to fail against current draft grants until Futures/Options privileges
-- are narrowed and paper_futures_orders receives the missing worker SELECT grant.

DO $worker_acl_contract$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'upstox_connections',
    'paper_market_worker_state',
    'paper_orders',
    'paper_protective_orders',
    'paper_equity_positions',
    'paper_futures_orders',
    'paper_futures_fills',
    'paper_option_limit_orders',
    'paper_option_limit_fills'
  ] LOOP
    IF NOT has_table_privilege('service_role','public.'||v_table,'SELECT') THEN
      RAISE EXCEPTION 'service_role is missing required worker SELECT on %',v_table;
    END IF;
    IF has_table_privilege('anon','public.'||v_table,'SELECT') THEN
      RAISE EXCEPTION 'anon unexpectedly has SELECT on internal worker table %',v_table;
    END IF;
    IF has_table_privilege('service_role','public.'||v_table,'DELETE') THEN
      RAISE EXCEPTION 'service_role has unnecessary direct DELETE on %',v_table;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'paper_market_worker_state','paper_protective_orders'
  ] LOOP
    IF NOT has_table_privilege('service_role','public.'||v_table,'UPDATE') THEN
      RAISE EXCEPTION 'service_role is missing required worker UPDATE on %',v_table;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'upstox_connections','paper_orders','paper_equity_positions',
    'paper_futures_orders','paper_futures_fills',
    'paper_option_limit_orders','paper_option_limit_fills'
  ] LOOP
    IF has_table_privilege('service_role','public.'||v_table,'INSERT')
       OR has_table_privilege('service_role','public.'||v_table,'UPDATE') THEN
      RAISE EXCEPTION 'service_role has unnecessary direct INSERT/UPDATE on %',v_table;
    END IF;
  END LOOP;

  IF has_table_privilege('service_role','public.paper_market_worker_state','INSERT')
     OR has_table_privilege('service_role','public.paper_protective_orders','INSERT') THEN
    RAISE EXCEPTION 'service_role has unnecessary direct INSERT on worker state/protective orders';
  END IF;

  IF has_table_privilege('anon','public.paper_market_worker_state','UPDATE')
     OR has_table_privilege('authenticated','public.paper_market_worker_state','UPDATE')
     OR has_table_privilege('anon','public.paper_protective_orders','UPDATE')
     OR has_table_privilege('authenticated','public.paper_protective_orders','UPDATE') THEN
    RAISE EXCEPTION 'A client role has private worker UPDATE privileges';
  END IF;
END
$worker_acl_contract$;

-- Exercise the actual SECURITY DEFINER lease RPC under service_role. A stale token
-- must neither release the current lease nor write the worker cursor.
SET LOCAL ROLE service_role;

DO $worker_lease_fencing$
DECLARE
  v_state_key constant text := 'paper_futures_limit_orders';
  v_token uuid := gen_random_uuid();
  v_stale_token uuid := gen_random_uuid();
  v_now_ms bigint;
  v_acquired boolean;
  v_released boolean;
  v_rows integer;
  v_current_token uuid;
BEGIN
  SELECT greatest(
    floor(extract(epoch from clock_timestamp())*1000)::bigint,
    coalesce(max((extract(epoch from lease_expires_at)*1000)::bigint+1),0)
  ) INTO v_now_ms
    FROM public.paper_market_worker_state
   WHERE state_key=v_state_key;

  SELECT public.acquire_paper_market_worker_lease(
    v_state_key,v_token,v_now_ms,30000
  ) INTO v_acquired;
  IF NOT v_acquired THEN
    RAISE EXCEPTION 'Could not acquire disposable Futures worker lease fixture';
  END IF;

  SELECT public.release_paper_market_worker_lease(
    v_state_key,v_stale_token,v_now_ms+1
  ) INTO v_released;
  IF v_released THEN
    RAISE EXCEPTION 'Stale worker token unexpectedly released the active lease';
  END IF;

  UPDATE public.paper_market_worker_state
     SET cursor_order_id='stale-token-write-must-not-land'
   WHERE state_key=v_state_key AND lease_token=v_stale_token;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'Stale worker token unexpectedly changed the cursor';
  END IF;

  SELECT lease_token INTO v_current_token
    FROM public.paper_market_worker_state
   WHERE state_key=v_state_key;
  IF v_current_token IS DISTINCT FROM v_token THEN
    RAISE EXCEPTION 'Stale release changed the active lease token';
  END IF;

  SELECT public.release_paper_market_worker_lease(
    v_state_key,v_token,v_now_ms+2
  ) INTO v_released;
  IF NOT v_released THEN
    RAISE EXCEPTION 'Current lease owner could not release its own lease';
  END IF;
END
$worker_lease_fencing$;

RESET ROLE;

DO $worker_rpc_acl$
DECLARE
  v_signature text;
  v_signatures text[] := ARRAY[
    'public.acquire_paper_market_worker_lease(text,uuid,bigint,bigint)',
    'public.release_paper_market_worker_lease(text,uuid,bigint)',
    'public.execute_paper_futures_limit_fill(text,text,integer,integer,bigint,bigint,bigint,integer,integer,bigint,bigint,bigint)',
    'public.expire_paper_futures_limit_order(text)',
    'public.submit_paper_option_limit_order(uuid,text,uuid,text,text,text,text,text,text,date,numeric,integer,integer,text,integer,bigint,bigint,timestamptz)',
    'public.cancel_paper_option_limit_order(uuid,text)',
    'public.expire_paper_option_limit_order(text)',
    'public.execute_paper_option_limit_fill(text,text,integer,integer,bigint,bigint,bigint,integer,integer,bigint,bigint)'
  ];
BEGIN
  FOREACH v_signature IN ARRAY v_signatures LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Required worker lifecycle RPC is missing: %',v_signature;
    END IF;
    IF NOT has_function_privilege('service_role',to_regprocedure(v_signature),'EXECUTE') THEN
      RAISE EXCEPTION 'service_role is missing EXECUTE on %',v_signature;
    END IF;
    IF has_function_privilege('anon',to_regprocedure(v_signature),'EXECUTE')
       OR has_function_privilege('authenticated',to_regprocedure(v_signature),'EXECUTE') THEN
      RAISE EXCEPTION 'Client role unexpectedly has EXECUTE on server lifecycle RPC %',v_signature;
    END IF;
  END LOOP;
END
$worker_rpc_acl$;
