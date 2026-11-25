-- Verify the narrowly scoped direct table privileges used by the market gateway.
-- Run after all ordered migrations in disposable PostgreSQL CI.

DO $market_gateway_service_role_grants$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'upstox_connections',
    'paper_market_worker_state',
    'paper_orders',
    'paper_protective_orders',
    'paper_equity_positions'
  ] LOOP
    IF NOT has_table_privilege('service_role','public.'||v_table,'SELECT') THEN
      RAISE EXCEPTION 'service_role is missing required SELECT on %',v_table;
    END IF;
    IF has_table_privilege('anon','public.'||v_table,'SELECT') THEN
      RAISE EXCEPTION 'anon unexpectedly has SELECT access to %',v_table;
    END IF;
  END LOOP;

  -- Browser users intentionally retain RLS-scoped SELECT on their own orders and
  -- equity positions. Provider connections and worker state stay server-only.
  FOREACH v_table IN ARRAY ARRAY[
    'upstox_connections','paper_market_worker_state'
  ] LOOP
    IF has_table_privilege('authenticated','public.'||v_table,'SELECT') THEN
      RAISE EXCEPTION 'authenticated unexpectedly has private SELECT access to %',v_table;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY['paper_market_worker_state','paper_protective_orders'] LOOP
    IF NOT has_table_privilege('service_role','public.'||v_table,'UPDATE') THEN
      RAISE EXCEPTION 'service_role is missing required UPDATE on %',v_table;
    END IF;
    IF has_table_privilege('anon','public.'||v_table,'UPDATE')
       OR has_table_privilege('authenticated','public.'||v_table,'UPDATE') THEN
      RAISE EXCEPTION 'Client role unexpectedly has private UPDATE access to %',v_table;
    END IF;
  END LOOP;

  IF has_table_privilege('service_role','public.upstox_connections','UPDATE')
     OR has_table_privilege('service_role','public.paper_orders','UPDATE')
     OR has_table_privilege('service_role','public.paper_equity_positions','UPDATE') THEN
    RAISE EXCEPTION 'service_role received an unnecessary UPDATE privilege';
  END IF;
END
$market_gateway_service_role_grants$;
