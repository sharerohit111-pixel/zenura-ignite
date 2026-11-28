-- Broker credential and OAuth nonce isolation smoke test.
-- Runs only against the disposable PostgreSQL service in CI.
INSERT INTO auth.users(id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
ON CONFLICT (id) DO NOTHING;

DO $privileges$
BEGIN
  IF has_table_privilege('anon','public.broker_connections','SELECT')
     OR has_table_privilege('authenticated','public.broker_connections','SELECT')
     OR has_table_privilege('anon','public.broker_connections','INSERT')
     OR has_table_privilege('authenticated','public.broker_connections','INSERT')
     OR has_table_privilege('authenticated','public.broker_connections','UPDATE')
     OR has_table_privilege('anon','public.broker_oauth_states','SELECT')
     OR has_table_privilege('authenticated','public.broker_oauth_states','SELECT')
     OR has_table_privilege('authenticated','public.broker_oauth_states','INSERT') THEN
    RAISE EXCEPTION 'Browser roles unexpectedly have broker credential or OAuth-state table privileges';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.broker_connections'::regclass)
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.broker_oauth_states'::regclass) THEN
    RAISE EXCEPTION 'Broker credential or OAuth-state RLS is not enabled and forced';
  END IF;
  IF NOT has_table_privilege('service_role','public.broker_connections','SELECT')
     OR NOT has_table_privilege('service_role','public.broker_oauth_states','INSERT') THEN
    RAISE EXCEPTION 'Service role lacks required broker storage privileges';
  END IF;
END
$privileges$;

SET ROLE service_role;
INSERT INTO public.broker_connections(
  user_id,broker_name,connection_status,access_token_ciphertext,token_expires_at
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fyers','connected',
  '{"v":"v1","iv":"AAAAAAAAAAAAAAAA","tag":"AAAAAAAAAAAAAAAAAAAAAA==","data":"ciphertext"}'::jsonb,
  now()+interval '1 day'
);
INSERT INTO public.broker_oauth_states(state_hash,user_id,broker_name,expires_at,created_at)
VALUES (repeat('c',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fyers',now()-interval '1 day',now()-interval '2 days');
INSERT INTO public.broker_oauth_states(state_hash,user_id,broker_name,expires_at,consumed_at,created_at)
VALUES (repeat('d',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fyers',now()+interval '5 minutes',now()-interval '2 days',now()-interval '2 days');
SELECT public.begin_broker_oauth_state(
  repeat('a',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fyers',now()+interval '5 minutes',now()
);
SELECT public.begin_broker_oauth_state(
  repeat('b',64),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','fyers',now()+interval '5 minutes',now()
);
DO $consume$
DECLARE
  v_user uuid;
  v_count integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.broker_oauth_states WHERE state_hash=repeat('c',64)) THEN
    RAISE EXCEPTION 'Expired OAuth state was not pruned when a new flow began';
  END IF;
  IF EXISTS (SELECT 1 FROM public.broker_oauth_states WHERE state_hash=repeat('d',64)) THEN
    RAISE EXCEPTION 'Old consumed OAuth state was not pruned when a new flow began';
  END IF;
  SELECT user_id INTO v_user FROM public.consume_broker_oauth_state(repeat('a',64),'fyers',now());
  IF v_user <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' THEN
    RAISE EXCEPTION 'OAuth state did not resolve to its owning user';
  END IF;
  SELECT count(*) INTO v_count FROM public.consume_broker_oauth_state(repeat('a',64),'fyers',now());
  IF v_count <> 0 THEN RAISE EXCEPTION 'OAuth state replay was accepted'; END IF;
  SELECT count(*) INTO v_count FROM public.consume_broker_oauth_state(repeat('b',64),'upstox',now());
  IF v_count <> 0 THEN RAISE EXCEPTION 'OAuth state was accepted for the wrong broker'; END IF;
  SELECT user_id INTO v_user FROM public.consume_broker_oauth_state(repeat('b',64),'fyers',now()+interval '11 minutes');
  IF v_user IS NOT NULL THEN RAISE EXCEPTION 'Expired OAuth state was accepted'; END IF;
END
$consume$;
RESET ROLE;
