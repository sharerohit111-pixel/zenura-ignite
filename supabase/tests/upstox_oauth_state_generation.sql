-- Disposable PostgreSQL integration test for Upstox OAuth state and generation guards.
-- Run only against a dedicated local/staging test database. Entire test rolls back.
BEGIN;

INSERT INTO auth.users(id) VALUES
 ('a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a')
ON CONFLICT(id) DO NOTHING;

DO $upstox_oauth$
DECLARE
  v_user uuid := 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0';
  v_state jsonb;
  v_generation bigint;
  v_saved boolean;
  v_expired_hash text := repeat('b',64);
BEGIN
  -- A state can be consumed exactly once and returns its bound user/generation.
  PERFORM public.begin_upstox_oauth(v_user,repeat('a',64),
    clock_timestamp()+interval '5 minutes',
    floor(extract(epoch from clock_timestamp())*1000)::bigint);
  v_state := public.consume_upstox_oauth_state(repeat('a',64),
    floor(extract(epoch from clock_timestamp())*1000)::bigint);
  IF v_state->>'user_id' IS DISTINCT FROM v_user::text
     OR (v_state->>'connection_generation')::bigint <> 0 THEN
    RAISE EXCEPTION 'OAuth state did not return its original user and generation: %',v_state;
  END IF;
  IF public.consume_upstox_oauth_state(repeat('a',64),
       floor(extract(epoch from clock_timestamp())*1000)::bigint) IS NOT NULL THEN
    RAISE EXCEPTION 'OAuth state replay was accepted';
  END IF;

  -- Expired state is rejected and remains unconsumed for audit/cleanup semantics.
  INSERT INTO public.upstox_oauth_states(
    state_hash,user_id,connection_generation,used,expires_at
  ) VALUES(v_expired_hash,v_user,0,false,clock_timestamp()-interval '1 second');
  IF public.consume_upstox_oauth_state(v_expired_hash,
       floor(extract(epoch from clock_timestamp())*1000)::bigint) IS NOT NULL THEN
    RAISE EXCEPTION 'Expired OAuth state was accepted';
  END IF;
  IF (SELECT used FROM public.upstox_oauth_states WHERE state_hash=v_expired_hash) THEN
    RAISE EXCEPTION 'Expired OAuth state should not be marked consumed';
  END IF;

  -- Disconnect increments generation; a callback captured before disconnect
  -- must not be able to recreate the connection afterward.
  v_generation := public.disconnect_upstox_connection(v_user,
    floor(extract(epoch from clock_timestamp())*1000)::bigint);
  IF v_generation <> 1 THEN
    RAISE EXCEPTION 'Disconnect did not increment generation to 1: %',v_generation;
  END IF;
  v_saved := public.save_upstox_connection(
    v_user,0,'{"v":"1"}'::jsonb,'Bearer',
    clock_timestamp()+interval '1 hour',clock_timestamp(),
    ARRAY[]::text[],floor(extract(epoch from clock_timestamp())*1000)::bigint
  );
  IF v_saved IS NOT FALSE THEN
    RAISE EXCEPTION 'Stale OAuth callback recreated a connection after disconnect';
  END IF;
  IF EXISTS(SELECT 1 FROM public.upstox_connections WHERE user_id=v_user) THEN
    RAISE EXCEPTION 'Stale OAuth callback left a connection row after disconnect';
  END IF;

  -- A fresh OAuth attempt after disconnect captures generation 1 and may save.
  v_generation := public.begin_upstox_oauth(v_user,repeat('c',64),
    clock_timestamp()+interval '5 minutes',
    floor(extract(epoch from clock_timestamp())*1000)::bigint);
  IF v_generation <> 1 THEN
    RAISE EXCEPTION 'New OAuth attempt did not capture current generation';
  END IF;
  v_state := public.consume_upstox_oauth_state(repeat('c',64),
    floor(extract(epoch from clock_timestamp())*1000)::bigint);
  IF (v_state->>'connection_generation')::bigint <> 1 THEN
    RAISE EXCEPTION 'New OAuth state did not bind generation 1';
  END IF;
  v_saved := public.save_upstox_connection(
    v_user,1,'{"v":"1"}'::jsonb,'Bearer',
    clock_timestamp()+interval '1 hour',clock_timestamp(),
    ARRAY[]::text[],floor(extract(epoch from clock_timestamp())*1000)::bigint
  );
  IF v_saved IS NOT TRUE OR NOT EXISTS(
    SELECT 1 FROM public.upstox_connections WHERE user_id=v_user
  ) THEN
    RAISE EXCEPTION 'Current-generation OAuth callback failed to save';
  END IF;

  v_generation := public.disconnect_upstox_connection(v_user,
    floor(extract(epoch from clock_timestamp())*1000)::bigint);
  IF v_generation <> 2 OR EXISTS(
    SELECT 1 FROM public.upstox_connections WHERE user_id=v_user
  ) THEN
    RAISE EXCEPTION 'Final disconnect did not remove the current connection';
  END IF;
END
$upstox_oauth$;

ROLLBACK;
