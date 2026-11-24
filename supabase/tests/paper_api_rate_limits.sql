-- Disposable PostgreSQL smoke test for distributed per-user API request budgets.
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('abababab-abab-4bab-8bab-abababababab'),
 ('bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc')
ON CONFLICT(id) DO NOTHING;

DO $api_rate_limit$
DECLARE
  v_result jsonb;
  v_i integer;
  v_user_a uuid:='abababab-abab-4bab-8bab-abababababab';
  v_user_b uuid:='bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc';
BEGIN
  FOR v_i IN 1..5 LOOP
    v_result:=public.consume_paper_api_rate_limit(v_user_a,'oauth');
    IF v_result->>'allowed'<>'true' THEN
      RAISE EXCEPTION 'OAuth request % was unexpectedly blocked: %',v_i,v_result;
    END IF;
  END LOOP;
  v_result:=public.consume_paper_api_rate_limit(v_user_a,'oauth');
  IF v_result->>'allowed'<>'false'
     OR (v_result->>'retry_after_seconds')::integer<1
     OR v_result->>'remaining'<>'0' THEN
    RAISE EXCEPTION 'OAuth bucket did not fail closed at its configured limit: %',v_result;
  END IF;

  -- Separate users and buckets must not consume one another's budgets.
  v_result:=public.consume_paper_api_rate_limit(v_user_b,'oauth');
  IF v_result->>'allowed'<>'true' THEN
    RAISE EXCEPTION 'A different user inherited another user''s exhausted bucket: %',v_result;
  END IF;
  v_result:=public.consume_paper_api_rate_limit(v_user_a,'paper_read');
  IF v_result->>'allowed'<>'true' THEN
    RAISE EXCEPTION 'A separate bucket inherited the OAuth budget: %',v_result;
  END IF;

  -- A fixed bucket cannot be selected with an arbitrary or unbounded name.
  BEGIN
    PERFORM public.consume_paper_api_rate_limit(v_user_a,'unbounded');
    RAISE EXCEPTION 'Unknown API rate-limit bucket was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
END
$api_rate_limit$;

DO $api_rate_limit_privileges$
BEGIN
  IF NOT has_function_privilege('service_role',
       'public.consume_paper_api_rate_limit(uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute the API rate-limit RPC';
  END IF;
  IF has_function_privilege('anon',
       'public.consume_paper_api_rate_limit(uuid,text)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.consume_paper_api_rate_limit(uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Client roles can execute the service-only API rate-limit RPC';
  END IF;
  IF has_table_privilege('service_role','public.paper_api_rate_limits','SELECT')
     OR has_table_privilege('authenticated','public.paper_api_rate_limits','SELECT')
     OR has_table_privilege('anon','public.paper_api_rate_limits','SELECT') THEN
    RAISE EXCEPTION 'A client/service role received direct table access';
  END IF;
END
$api_rate_limit_privileges$;
ROLLBACK;
