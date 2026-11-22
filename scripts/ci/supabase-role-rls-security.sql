\set ON_ERROR_STOP on
-- Disposable PostgreSQL role/RLS assertions for the draft PR #70 migrations.
-- Run as postgres after migrations. Never point this test at a real project.

DO $$
DECLARE
  fn regprocedure;
  fn_names text[] := ARRAY[
    'public.initialize_paper_trading_account(uuid)',
    'public.execute_paper_market_order(uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint)',
    'public.submit_paper_limit_order(uuid,text,uuid,text,text,text,text,text,integer,bigint)',
    'public.execute_paper_limit_fill(text,bigint,bigint,bigint,bigint)',
    'public.cancel_paper_limit_order(uuid,text)',
    'public.execute_paper_long_option_order(uuid,text,uuid,text,text,text,text,text,text,date,numeric,integer,integer,integer,text,bigint,bigint,bigint)'
  ];
  acl record;
  t text;
  all_tables text[] := ARRAY[
    'paper_user_identity_map','paper_accounts','paper_equity_positions',
    'paper_derivative_positions','paper_orders','paper_derivative_orders','paper_watchlists',
    'upstox_connections','upstox_oauth_states','upstox_connection_controls',
    'paper_market_stream_leases','paper_market_worker_state','paper_margin_preview_limits'
  ];
  server_only_tables text[] := ARRAY[
    'paper_user_identity_map','paper_accounts','paper_equity_positions',
    'paper_derivative_positions','paper_orders','paper_derivative_orders',
    'upstox_connections','upstox_oauth_states','upstox_connection_controls',
    'paper_market_stream_leases','paper_market_worker_state','paper_margin_preview_limits'
  ];
BEGIN
  FOREACH t IN ARRAY fn_names LOOP
    fn := to_regprocedure(t);
    IF fn IS NULL THEN RAISE EXCEPTION 'Missing expected RPC: %', t; END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute %', t;
    END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE')
       OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon/authenticated can execute %', t;
    END IF;
    -- PostgreSQL ACL grantee 0 is PUBLIC.
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.oid=fn AND a.grantee=0 AND a.privilege_type='EXECUTE'
    ) THEN
      RAISE EXCEPTION 'PUBLIC can execute %', t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY all_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=t AND c.relrowsecurity
    ) THEN RAISE EXCEPTION 'RLS is not enabled on %', t; END IF;
  END LOOP;

  FOREACH t IN ARRAY server_only_tables LOOP
    IF has_table_privilege('anon', 'public.'||t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.'||t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.'||t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.'||t, 'DELETE') THEN
      RAISE EXCEPTION 'Unexpected anon/read or authenticated/write grant on %', t;
    END IF;
  END LOOP;

  IF NOT has_table_privilege('authenticated','public.paper_accounts','SELECT')
     OR NOT has_table_privilege('authenticated','public.paper_orders','SELECT')
     OR NOT has_table_privilege('authenticated','public.paper_equity_positions','SELECT') THEN
    RAISE EXCEPTION 'Expected authenticated read grants are missing';
  END IF;
  IF NOT has_table_privilege('authenticated','public.paper_watchlists','INSERT')
     OR NOT has_table_privilege('authenticated','public.paper_watchlists','UPDATE')
     OR NOT has_table_privilege('authenticated','public.paper_watchlists','DELETE') THEN
    RAISE EXCEPTION 'Expected authenticated watchlist CRUD grants are missing';
  END IF;
  IF has_table_privilege('anon','public.paper_watchlists','SELECT')
     OR has_table_privilege('anon','public.paper_watchlists','INSERT') THEN
    RAISE EXCEPTION 'anon unexpectedly has watchlist access';
  END IF;
END
$$;

INSERT INTO auth.users(id) VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');

SET ROLE service_role;
SELECT public.initialize_paper_trading_account('11111111-1111-4111-8111-111111111111');
SELECT public.initialize_paper_trading_account('22222222-2222-4222-8222-222222222222');
RESET ROLE;

-- Authenticated user A sees only A's account and can only write A's watchlist.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.paper_accounts) <> 1 THEN
    RAISE EXCEPTION 'RLS failed: user A does not see exactly one own account';
  END IF;
  IF EXISTS (SELECT 1 FROM public.paper_accounts WHERE user_id='22222222-2222-4222-8222-222222222222') THEN
    RAISE EXCEPTION 'RLS failed: user A can see user B account';
  END IF;
END
$$;
INSERT INTO public.paper_watchlists(user_id,name,instrument_keys)
VALUES ('11111111-1111-4111-8111-111111111111','My Stocks',ARRAY['NSE_EQ|TEST001']);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.paper_watchlists(user_id,name,instrument_keys)
    VALUES ('22222222-2222-4222-8222-222222222222','Banking',ARRAY['NSE_EQ|TEST002']);
    RAISE EXCEPTION 'RLS failed: user A inserted user B watchlist';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF (SELECT count(*) FROM public.paper_watchlists) <> 1 THEN
    RAISE EXCEPTION 'RLS failed: user A sees unexpected watchlist rows';
  END IF;
END
$$;
ROLLBACK;

-- Authenticated cannot mutate account/position/order rows directly.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $$
BEGIN
  IF has_table_privilege(current_user,'public.paper_accounts','UPDATE')
     OR has_table_privilege(current_user,'public.paper_orders','INSERT')
     OR has_table_privilege(current_user,'public.paper_equity_positions','DELETE') THEN
    RAISE EXCEPTION 'Authenticated direct trading writes are unexpectedly granted';
  END IF;
END
$$;
ROLLBACK;

-- anon receives no user data or watchlist access.
DO $$
BEGIN
  IF has_table_privilege('anon','public.paper_accounts','SELECT')
     OR has_table_privilege('anon','public.paper_watchlists','SELECT') THEN
    RAISE EXCEPTION 'anon unexpectedly has user data access';
  END IF;
END
$$;

SELECT 'security role and RLS assertions passed' AS result;
