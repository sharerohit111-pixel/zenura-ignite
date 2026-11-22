-- Run after all ordered migrations in the disposable PostgreSQL workflow.
-- Verifies table privileges and RLS ownership for Firebase third-party JWT users.

INSERT INTO public.paper_watchlists(user_id,name,instrument_keys)
VALUES
  ('11111111-1111-4111-8111-111111111111','My Stocks',ARRAY['NSE_EQ|OWN']),
  ('22222222-2222-4222-8222-222222222222','My Stocks',ARRAY['NSE_EQ|OTHER'])
ON CONFLICT (user_id,name) DO UPDATE
SET instrument_keys=excluded.instrument_keys;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"firebase-test-user-one","role":"authenticated"}',false);

DO $rls_privileges$
DECLARE
  v_count integer;
  v_rows integer;
BEGIN
  IF NOT has_table_privilege('authenticated','public.paper_accounts','SELECT')
     OR NOT has_table_privilege('authenticated','public.paper_orders','SELECT')
     OR NOT has_table_privilege('authenticated','public.paper_derivative_orders','SELECT')
     OR NOT has_table_privilege('authenticated','public.paper_equity_positions','SELECT')
     OR NOT has_table_privilege('authenticated','public.paper_derivative_positions','SELECT') THEN
    RAISE EXCEPTION 'Authenticated role is missing a required Paper Trading read grant';
  END IF;

  IF has_table_privilege('authenticated','public.paper_accounts','INSERT')
     OR has_table_privilege('authenticated','public.paper_accounts','UPDATE')
     OR has_table_privilege('authenticated','public.paper_orders','INSERT')
     OR has_table_privilege('authenticated','public.paper_derivative_orders','DELETE') THEN
    RAISE EXCEPTION 'Authenticated role unexpectedly has direct trading write privileges';
  END IF;

  IF has_table_privilege('authenticated','public.paper_user_identity_map','SELECT')
     OR has_table_privilege('authenticated','public.upstox_connections','SELECT')
     OR has_table_privilege('authenticated','public.upstox_oauth_states','SELECT')
     OR has_table_privilege('authenticated','public.paper_market_worker_state','SELECT') THEN
    RAISE EXCEPTION 'Authenticated role can access a private identity/provider/worker table';
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
DELETE FROM public.paper_watchlists
 WHERE (user_id='11111111-1111-4111-8111-111111111111' AND name IN ('My Stocks','Banking'))
    OR (user_id='22222222-2222-4222-8222-222222222222' AND name='My Stocks');
