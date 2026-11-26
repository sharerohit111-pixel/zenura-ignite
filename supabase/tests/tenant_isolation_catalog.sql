-- Read-only catalog regression for hosted tenant-isolation boundaries.
-- Runs only against the disposable PostgreSQL database in CI after all migrations.
-- This deliberately creates/updates/deletes no rows and never contacts hosted Supabase.

DO $tenant_isolation_catalog$
DECLARE
  v_table text;
  v_policy_count integer;
  v_proc record;
BEGIN
  -- Every user-owned paper-trading/history/preferences relation must have RLS
  -- and an authenticated SELECT policy bound to auth.uid() = user_id.
  FOREACH v_table IN ARRAY ARRAY[
    'paper_accounts',
    'paper_equity_positions',
    'paper_derivative_positions',
    'paper_orders',
    'paper_derivative_orders',
    'paper_futures_positions',
    'paper_futures_orders',
    'paper_protective_orders',
    'paper_watchlists',
    'paper_chart_drawings',
    'paper_chart_templates',
    'paper_chart_preferences'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public'
         AND c.relname=v_table
         AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%',v_table;
    END IF;

    SELECT count(*) INTO v_policy_count
      FROM pg_policies
     WHERE schemaname='public'
       AND tablename=v_table
       AND cmd='SELECT'
       AND 'authenticated'=ANY(roles)
       AND position('auth.uid()' in coalesce(qual,'')) > 0
       AND position('user_id' in coalesce(qual,'')) > 0;

    IF v_policy_count=0 THEN
      RAISE EXCEPTION 'Missing auth.uid()-scoped SELECT policy on public.%',v_table;
    END IF;

    IF has_table_privilege('anon','public.'||v_table,'SELECT') THEN
      RAISE EXCEPTION 'anon unexpectedly has SELECT on public.%',v_table;
    END IF;
  END LOOP;

  -- Ledger mutation remains behind trusted server-side RPCs. Client writes
  -- directly to account/order/position/fill state must remain impossible.
  FOREACH v_table IN ARRAY ARRAY[
    'paper_accounts',
    'paper_equity_positions',
    'paper_derivative_positions',
    'paper_orders',
    'paper_derivative_orders',
    'paper_futures_positions',
    'paper_futures_orders',
    'paper_protective_orders'
  ] LOOP
    IF has_table_privilege('authenticated','public.'||v_table,'INSERT')
       OR has_table_privilege('authenticated','public.'||v_table,'UPDATE')
       OR has_table_privilege('authenticated','public.'||v_table,'DELETE')
       OR has_table_privilege('anon','public.'||v_table,'INSERT')
       OR has_table_privilege('anon','public.'||v_table,'UPDATE')
       OR has_table_privilege('anon','public.'||v_table,'DELETE') THEN
      RAISE EXCEPTION 'Client role has direct ledger write access to public.%',v_table;
    END IF;
  END LOOP;

  -- These provider, worker and rate-limit internals are service-only.
  FOREACH v_table IN ARRAY ARRAY[
    'paper_margin_preview_limits',
    'paper_market_worker_state',
    'paper_market_stream_leases',
    'upstox_connection_controls',
    'upstox_connections',
    'upstox_oauth_states'
  ] LOOP
    IF has_table_privilege('anon','public.'||v_table,'SELECT')
       OR has_table_privilege('authenticated','public.'||v_table,'SELECT')
       OR has_table_privilege('anon','public.'||v_table,'INSERT')
       OR has_table_privilege('authenticated','public.'||v_table,'INSERT')
       OR has_table_privilege('anon','public.'||v_table,'UPDATE')
       OR has_table_privilege('authenticated','public.'||v_table,'UPDATE')
       OR has_table_privilege('anon','public.'||v_table,'DELETE')
       OR has_table_privilege('authenticated','public.'||v_table,'DELETE') THEN
      RAISE EXCEPTION 'Client role has access to internal table public.%',v_table;
    END IF;
  END LOOP;

  -- SECURITY DEFINER functions must pin search_path and must never be
  -- executable by anon (including via PUBLIC inheritance). Authenticated
  -- execution is permitted only for the two explicitly user-facing protective
  -- order RPCs, whose bodies independently bind p_user_id to auth.uid().
  FOR v_proc IN
    SELECT p.oid,p.proname,p.proconfig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.prosecdef
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM unnest(coalesce(v_proc.proconfig,ARRAY[]::text[])) setting
       WHERE setting LIKE 'search_path=%'
    ) THEN
      RAISE EXCEPTION 'SECURITY DEFINER function % has no pinned search_path',v_proc.proname;
    END IF;
    IF has_function_privilege('anon',v_proc.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'SECURITY DEFINER function % is callable by anon',v_proc.proname;
    END IF;
    IF has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
       AND v_proc.oid NOT IN (
         to_regprocedure('public.create_paper_equity_protective_order(uuid,uuid,text,text,text,bigint,integer)'),
         to_regprocedure('public.cancel_paper_protective_order(uuid,uuid)')
       ) THEN
      RAISE EXCEPTION 'Unapproved SECURITY DEFINER function % is callable by authenticated',v_proc.proname;
    END IF;
  END LOOP;

  -- The two allowlisted client RPCs must exist, remain SECURITY DEFINER,
  -- retain their pinned search_path, and enforce caller ownership internally.
  FOR v_proc IN
    SELECT p.oid,p.proname,p.prosrc,p.proconfig
      FROM pg_proc p
     WHERE p.oid IN (
       to_regprocedure('public.create_paper_equity_protective_order(uuid,uuid,text,text,text,bigint,integer)'),
       to_regprocedure('public.cancel_paper_protective_order(uuid,uuid)')
     )
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM unnest(coalesce(v_proc.proconfig,ARRAY[]::text[])) setting
       WHERE setting LIKE 'search_path=%'
    ) THEN
      RAISE EXCEPTION 'Allowlisted protective RPC % has no pinned search_path',v_proc.proname;
    END IF;
    IF NOT has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
       OR has_function_privilege('anon',v_proc.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Protective RPC % has incorrect client execution grants',v_proc.proname;
    END IF;
    IF v_proc.prosrc !~* 'auth[.]uid[[:space:]]*[(][)]'
       OR v_proc.prosrc !~* 'p_user_id[[:space:]]+is[[:space:]]+distinct[[:space:]]+from[[:space:]]+auth[.]uid[[:space:]]*[(][)]' THEN
      RAISE EXCEPTION 'Protective RPC % lacks an explicit auth.uid()-bound owner check',v_proc.proname;
    END IF;
  END LOOP;

  IF to_regprocedure('public.create_paper_equity_protective_order(uuid,uuid,text,text,text,bigint,integer)') IS NULL
     OR to_regprocedure('public.cancel_paper_protective_order(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Expected owner-bound protective order RPC is missing';
  END IF;
END
$tenant_isolation_catalog$;
