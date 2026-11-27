-- Disposable PostgreSQL integration test for Upstox OAuth state and generation guards.
-- Run only against a dedicated local/staging test database. Entire test rolls back.
BEGIN;

INSERT INTO auth.users(id) VALUES
 ('a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0')
ON CONFLICT(id) DO NOTHING;

DO $upstox_oauth$
DECLARE
  v_user uuid := 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0';
  v_state jsonb;
  v_generation bigint;
  v_saved boolean;
  v_replay_hash text := md5('zenura-upstox-state-generation-replay') || md5('zenura-upstox-state-generation-replay-v2');
  v_expired_hash text := md5('zenura-upstox-state-generation-expired') || md5('zenura-upstox-state-generation-expired-v2');
  v_new_hash text := md5('zenura-upstox-state-generation-new') || md5('zenura-upstox-state-generation-new-v2');
  v_fresh_hash text := md5('zenura-upstox-state-generation-fresh') || md5('zenura-upstox-state-generation-fresh-v2');
BEGIN
  -- A state can be consumed exactly once and returns its bound user/generation.
  PERFORM public.begin_upstox_oauth(v_user,v_replay_hash,
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

  -- Each authorization start prunes at most 500 states older than the
  -- one-day retention window, while preserving newer expired rows.
  INSERT INTO public.upstox_oauth_states(
    state_hash,user_id,connection_generation,used,expires_at
  )
  SELECT (md5('zenura-upstox-state-generation-prune:'||n::text) || md5('zenura-upstox-state-generation-prune-v2:'||n::text)),v_user,0,true,
         clock_timestamp()-interval '2 days'
    FROM generate_series(1,501) AS n;
  PERFORM public.begin_upstox_oauth(v_user,v_new_hash,
    clock_timestamp()+interval '5 minutes',
    floor(extract(epoch from clock_timestamp())*1000)::bigint);
  IF (SELECT count(*) FROM public.upstox_oauth_states
       WHERE expires_at<clock_timestamp()-interval '1 day')<>1 THEN
    RAISE EXCEPTION 'OAuth state cleanup did not prune exactly 500 old rows';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.upstox_oauth_states WHERE state_hash=v_new_hash) THEN
    RAISE EXCEPTION 'OAuth state cleanup removed the newly created state';
  END IF;
  IF to_regclass('public.upstox_oauth_states_expires_at_idx') IS NULL THEN
    RAISE EXCEPTION 'OAuth state expiry index is missing';
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
  v_generation := public.begin_upstox_oauth(v_user,v_fresh_hash,
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
