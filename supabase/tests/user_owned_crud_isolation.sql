-- Disposable PostgreSQL regression for every browser-editable user-owned table.
-- Seeds two tenants as the migration owner, then verifies CRUD isolation as each JWT user.
-- This file is CI-only; it does not connect to hosted Supabase.

DO $preflight$
DECLARE
  t text;
  c text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'paper_watchlists','paper_chart_drawings','paper_chart_templates','paper_chart_preferences'
  ] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||t)) THEN
      RAISE EXCEPTION 'RLS disabled on public.%',t;
    END IF;
    FOREACH c IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies p
         WHERE p.schemaname='public' AND p.tablename=t AND p.cmd=c
           AND 'authenticated'=ANY(p.roles)
           AND CASE c
             WHEN 'SELECT' THEN coalesce(p.qual,'') ILIKE '%auth.uid()%'
                                  AND coalesce(p.qual,'') ILIKE '%user_id%'
             WHEN 'INSERT' THEN coalesce(p.with_check,'') ILIKE '%auth.uid()%'
                                   AND coalesce(p.with_check,'') ILIKE '%user_id%'
             WHEN 'UPDATE' THEN coalesce(p.qual,'') ILIKE '%auth.uid()%'
                                   AND coalesce(p.qual,'') ILIKE '%user_id%'
                                   AND coalesce(p.with_check,'') ILIKE '%auth.uid()%'
                                   AND coalesce(p.with_check,'') ILIKE '%user_id%'
             WHEN 'DELETE' THEN coalesce(p.qual,'') ILIKE '%auth.uid()%'
                                   AND coalesce(p.qual,'') ILIKE '%user_id%'
           END
      ) THEN
        RAISE EXCEPTION 'Missing owner-bound % policy on public.%',c,t;
      END IF;
    END LOOP;
    IF NOT has_table_privilege('authenticated','public.'||t,'SELECT')
       OR NOT has_table_privilege('authenticated','public.'||t,'INSERT')
       OR NOT has_table_privilege('authenticated','public.'||t,'UPDATE')
       OR NOT has_table_privilege('authenticated','public.'||t,'DELETE') THEN
      RAISE EXCEPTION 'Authenticated CRUD grants incomplete on public.%',t;
    END IF;
    IF has_table_privilege('anon','public.'||t,'SELECT')
       OR has_table_privilege('anon','public.'||t,'INSERT')
       OR has_table_privilege('anon','public.'||t,'UPDATE')
       OR has_table_privilege('anon','public.'||t,'DELETE') THEN
      RAISE EXCEPTION 'anon has unexpected CRUD grant on public.%',t;
    END IF;
  END LOOP;
END
$preflight$;

-- Two independent users are already created by the migration smoke workflow.
INSERT INTO public.paper_watchlists(user_id,name,instrument_keys) VALUES
 ('11111111-1111-4111-8111-111111111111','My Stocks',ARRAY['RLS-CRUD-A']),
 ('22222222-2222-4222-8222-222222222222','Banking',ARRAY['RLS-CRUD-B']);

INSERT INTO public.paper_chart_drawings(user_id,instrument_key,timeframe,drawing_type,payload) VALUES
 ('11111111-1111-4111-8111-111111111111','RLS-CRUD-A','5m','TRENDLINE','{"owner":"A"}'::jsonb),
 ('22222222-2222-4222-8222-222222222222','RLS-CRUD-B','5m','TRENDLINE','{"owner":"B"}'::jsonb);

INSERT INTO public.paper_chart_templates(user_id,name,configuration) VALUES
 ('11111111-1111-4111-8111-111111111111','RLS CRUD A','{"owner":"A"}'::jsonb),
 ('22222222-2222-4222-8222-222222222222','RLS CRUD B','{"owner":"B"}'::jsonb);

INSERT INTO public.paper_chart_preferences(user_id,instrument_key,chart_type,timeframe,theme,indicators) VALUES
 ('11111111-1111-4111-8111-111111111111','RLS-CRUD-A','CANDLE','5m','DARK','[]'::jsonb),
 ('22222222-2222-4222-8222-222222222222','RLS-CRUD-B','CANDLE','5m','DARK','[]'::jsonb);

SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',false);

DO $user_a$
DECLARE
  n integer;
BEGIN
  IF (SELECT count(*) FROM public.paper_watchlists WHERE name IN ('My Stocks','Banking'))<>1
     OR (SELECT count(*) FROM public.paper_chart_drawings WHERE instrument_key IN ('RLS-CRUD-A','RLS-CRUD-B'))<>1
     OR (SELECT count(*) FROM public.paper_chart_templates WHERE name IN ('RLS CRUD A','RLS CRUD B'))<>1
     OR (SELECT count(*) FROM public.paper_chart_preferences WHERE instrument_key IN ('RLS-CRUD-A','RLS-CRUD-B'))<>1 THEN
    RAISE EXCEPTION 'User A SELECT isolation failed for one or more editable tables';
  END IF;

  -- Cross-tenant INSERT must fail WITH CHECK for each editable table.
  BEGIN
    INSERT INTO public.paper_watchlists(user_id,name,instrument_keys)
    VALUES ('22222222-2222-4222-8222-222222222222','F&O',ARRAY['RLS-CRUD-X']);
    RAISE EXCEPTION 'Cross-user watchlist INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.paper_chart_drawings(user_id,instrument_key,timeframe,drawing_type,payload)
    VALUES ('22222222-2222-4222-8222-222222222222','RLS-CRUD-X','5m','RAY','{}'::jsonb);
    RAISE EXCEPTION 'Cross-user drawing INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.paper_chart_templates(user_id,name,configuration)
    VALUES ('22222222-2222-4222-8222-222222222222','RLS CRUD X','{}'::jsonb);
    RAISE EXCEPTION 'Cross-user template INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.paper_chart_preferences(user_id,instrument_key)
    VALUES ('22222222-2222-4222-8222-222222222222','RLS-CRUD-X');
    RAISE EXCEPTION 'Cross-user preference INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- UPDATE/DELETE against tenant B rows must affect zero rows, never leak them.
  UPDATE public.paper_watchlists SET instrument_keys=ARRAY['TAMPERED']
   WHERE user_id='22222222-2222-4222-2222-222222222222' AND name='Banking';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'User A updated B watchlist'; END IF;
  DELETE FROM public.paper_watchlists WHERE user_id='22222222-2222-4222-8222-222222222222' AND name='Banking';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'User A deleted B watchlist'; END IF;

  UPDATE public.paper_chart_drawings SET payload='{"tampered":true}'::jsonb
   WHERE user_id='22222222-2222-4222-8222-222222222222' AND instrument_key='RLS-CRUD-B';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'User A updated B drawing'; END IF;
  DELETE FROM public.paper_chart_drawings WHERE user_id='22222222-2222-4222-8222-222222222222' AND instrument_key='RLS-CRUD-B';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'User A deleted B drawing'; END IF;

  UPDATE public.paper_chart_templates SET configuration='{"tampered":true}'::jsonb
   WHERE user_id='22222222-2222-4222-8222-222222222222' AND name='RLS CRUD B';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'User A updated B template'; END IF;
  DELETE FROM public.paper_chart_templates WHERE user_id='22222222-2222-4222-8222-222222222222' AND name='RLS CRUD B';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'User A deleted B template'; END IF;

  UPDATE public.paper_chart_preferences SET theme='LIGHT'
   WHERE user_id='22222222-2222-4222-8222-222222222222' AND instrument_key='RLS-CRUD-B';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'User A updated B preference'; END IF;
  DELETE FROM public.paper_chart_preferences
   WHERE user_id='22222222-2222-4222-8222-222222222222' AND instrument_key='RLS-CRUD-B';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'User A deleted B preference'; END IF;

  -- A user must not be able to transfer ownership of an existing own row.
  BEGIN
    UPDATE public.paper_watchlists SET user_id='22222222-2222-4222-8222-222222222222'
     WHERE user_id='11111111-1111-4111-8111-111111111111' AND name='My Stocks';
    RAISE EXCEPTION 'Watchlist owner reassignment unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.paper_chart_drawings SET user_id='22222222-2222-4222-8222-222222222222'
     WHERE user_id='11111111-1111-4111-8111-111111111111' AND instrument_key='RLS-CRUD-A';
    RAISE EXCEPTION 'Drawing owner reassignment unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.paper_chart_templates SET user_id='22222222-2222-4222-8222-222222222222'
     WHERE user_id='11111111-1111-4111-8111-111111111111' AND name='RLS CRUD A';
    RAISE EXCEPTION 'Template owner reassignment unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.paper_chart_preferences SET user_id='22222222-2222-4222-8222-222222222222'
     WHERE user_id='11111111-1111-4111-8111-111111111111' AND instrument_key='RLS-CRUD-A';
    RAISE EXCEPTION 'Preference owner reassignment unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Positive own-tenant mutations verify CRUD is not accidentally disabled.
  UPDATE public.paper_watchlists SET instrument_keys=ARRAY['RLS-CRUD-A','OWN-UPDATED']
   WHERE user_id='11111111-1111-4111-8111-111111111111' AND name='My Stocks';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Own watchlist UPDATE failed'; END IF;
  UPDATE public.paper_chart_drawings SET payload='{"owner":"A","updated":true}'::jsonb
   WHERE user_id='11111111-1111-4111-8111-111111111111' AND instrument_key='RLS-CRUD-A';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Own drawing UPDATE failed'; END IF;
  UPDATE public.paper_chart_templates SET configuration='{"owner":"A","updated":true}'::jsonb
   WHERE user_id='11111111-1111-4111-8111-111111111111' AND name='RLS CRUD A';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Own template UPDATE failed'; END IF;
  UPDATE public.paper_chart_preferences SET theme='LIGHT'
   WHERE user_id='11111111-1111-4111-8111-111111111111' AND instrument_key='RLS-CRUD-A';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Own preference UPDATE failed'; END IF;
END
$user_a$;

SELECT set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',false);
DO $user_b$
BEGIN
  IF (SELECT count(*) FROM public.paper_watchlists WHERE name IN ('My Stocks','Banking'))<>1
     OR (SELECT count(*) FROM public.paper_chart_drawings WHERE instrument_key IN ('RLS-CRUD-A','RLS-CRUD-B'))<>1
     OR (SELECT count(*) FROM public.paper_chart_templates WHERE name IN ('RLS CRUD A','RLS CRUD B'))<>1
     OR (SELECT count(*) FROM public.paper_chart_preferences WHERE instrument_key IN ('RLS-CRUD-A','RLS-CRUD-B'))<>1 THEN
    RAISE EXCEPTION 'User B SELECT isolation failed for one or more editable tables';
  END IF;
END
$user_b$;
RESET ROLE;

-- Cleanup only the disposable test fixtures.
DELETE FROM public.paper_watchlists WHERE user_id IN (
 '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'
) AND (instrument_keys && ARRAY['RLS-CRUD-A','RLS-CRUD-B','RLS-CRUD-X','OWN-UPDATED']);
DELETE FROM public.paper_chart_drawings WHERE instrument_key IN ('RLS-CRUD-A','RLS-CRUD-B','RLS-CRUD-X');
DELETE FROM public.paper_chart_templates WHERE name IN ('RLS CRUD A','RLS CRUD B','RLS CRUD X');
DELETE FROM public.paper_chart_preferences WHERE instrument_key IN ('RLS-CRUD-A','RLS-CRUD-B','RLS-CRUD-X');
