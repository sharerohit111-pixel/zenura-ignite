-- Run after all ordered migrations in the disposable PostgreSQL workflow.
-- Verifies table privileges and RLS ownership for native Supabase Auth users.

INSERT INTO public.paper_watchlists(user_id,name,instrument_keys)
VALUES
  ('11111111-1111-4111-8111-111111111111','My Stocks',ARRAY['NSE_EQ|OWN']),
  ('22222222-2222-4222-8222-222222222222','My Stocks',ARRAY['NSE_EQ|OTHER'])
ON CONFLICT (user_id,name) DO UPDATE
SET instrument_keys=excluded.instrument_keys;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',false);

DO $rls_privileges$
DECLARE
  v_count integer;
  v_rows integer;
  v_table text;
  v_policy_count integer;
BEGIN
  -- Require an authenticated auth.uid()-scoped read policy on every private
  -- Paper Trading account, position, order and watchlist table.
  FOREACH v_table IN ARRAY ARRAY[
    'paper_accounts','paper_equity_positions','paper_derivative_positions',
    'paper_orders','paper_derivative_orders','paper_watchlists'
  ] LOOP
    SELECT count(*) INTO v_policy_count
      FROM pg_policies
     WHERE schemaname='public'
       AND tablename=v_table
       AND 'authenticated'=ANY(roles)
       AND coalesce(qual,'') ~* 'auth\.uid\(\)'
       AND coalesce(qual,'') ~* 'user_id';
    IF v_policy_count=0 THEN
      RAISE EXCEPTION 'Missing authenticated owner-scoped SELECT policy for public.%',v_table;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated','public.paper_accounts','SELECT')
     OR NOT has_table_privilege('authenticated','public.paper_orders','SELECT')
     OR NOT has_table_privilege('authenticated','public.paper_derivative_orders','SELECT')
     OR NOT has_table_privilege('authenticated','public.paper_equity_positions','SELECT')
     OR NOT has_table_privilege('authenticated','public.paper_derivative_positions','SELECT') THEN
    RAISE EXCEPTION 'Authenticated role is missing a required Paper Trading read grant';
  END IF;

  IF has_table_privilege('authenticated','public.paper_futures_orders','INSERT')
     OR has_table_privilege('authenticated','public.paper_protective_orders','INSERT')
     OR has_table_privilege('authenticated','public.paper_accounts','INSERT')
     OR has_table_privilege('authenticated','public.paper_accounts','UPDATE')
     OR has_table_privilege('authenticated','public.paper_orders','INSERT')
     OR has_table_privilege('authenticated','public.paper_derivative_orders','DELETE') THEN
    RAISE EXCEPTION 'Authenticated role unexpectedly has direct trading write privileges';
  END IF;

  IF has_table_privilege('authenticated','public.upstox_connections','SELECT')
     OR has_table_privilege('authenticated','public.upstox_oauth_states','SELECT')
     OR has_table_privilege('authenticated','public.paper_market_worker_state','SELECT') THEN
    RAISE EXCEPTION 'Authenticated role can access a private identity/provider/worker table';
  END IF;

  INSERT INTO public.paper_chart_drawings(user_id,instrument_key,timeframe,drawing_type,payload)
  VALUES ('11111111-1111-4111-8111-111111111111','NSE_EQ|OWN','5m','TRENDLINE','{"points":[[1,2],[3,4]]}'::jsonb);
  SELECT count(*) INTO v_count FROM public.paper_chart_drawings;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Chart drawing RLS should expose exactly one own drawing';
  END IF;
  BEGIN
    INSERT INTO public.paper_chart_drawings(user_id,instrument_key,timeframe,drawing_type,payload)
    VALUES ('22222222-2222-4222-8222-222222222222','NSE_EQ|OTHER','5m','RAY','{"points":[[1,2],[3,4]]}'::jsonb);
    RAISE EXCEPTION 'Cross-user chart drawing insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  SELECT count(*) INTO v_count FROM public.paper_chart_drawings;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Cross-user chart drawing insert created an unauthorized row';
  END IF;

  SELECT count(*) INTO v_count FROM public.paper_accounts;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'RLS account read should expose exactly one own account; got %',v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.paper_watchlists;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'RLS watchlist read should expose exactly one own list; got %',v_count;
  END IF;

  INSERT INTO public.paper_watchlists(user_id,name,instrument_keys)
  VALUES ('11111111-1111-4111-8111-111111111111','Banking',ARRAY['NSE_EQ|BANK']);
  UPDATE public.paper_watchlists
     SET instrument_keys=ARRAY['NSE_EQ|OWN','NSE_EQ|UPDATED']
   WHERE user_id='11111111-1111-4111-8111-111111111111'
     AND name='My Stocks';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Own watchlist update did not affect exactly one row';
  END IF;

  UPDATE public.paper_watchlists
     SET instrument_keys=ARRAY['NSE_EQ|TAMPERED']
   WHERE user_id='22222222-2222-4222-8222-222222222222'
     AND name='My Stocks';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'Cross-user watchlist update unexpectedly changed a row';
  END IF;

  DELETE FROM public.paper_watchlists
   WHERE user_id='11111111-1111-4111-8111-111111111111'
     AND name='Banking';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Own watchlist delete did not affect exactly one row';
  END IF;
END
$rls_privileges$;

RESET ROLE;

-- Keep the focused permission test isolated from the later shared-tenant RLS suite.
DELETE FROM public.paper_chart_drawings WHERE user_id IN ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
DELETE FROM public.paper_watchlists
 WHERE (user_id='11111111-1111-4111-8111-111111111111' AND name IN ('My Stocks','Banking'))
    OR (user_id='22222222-2222-4222-8222-222222222222' AND name='My Stocks');
