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
  v_rows integer;
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

  -- Seed an existing exhausted row, move it to an expired window, and
  -- assert that the RPC resets that same row rather than inserting a new one.
  INSERT INTO public.paper_api_rate_limits(user_id,bucket,window_start_ms,request_count)
  VALUES(v_user_a,'market_data',
         floor(extract(epoch FROM clock_timestamp())*1000)::bigint,30)
  ON CONFLICT(user_id,bucket) DO UPDATE SET
    window_start_ms=EXCLUDED.window_start_ms,request_count=30;
  UPDATE public.paper_api_rate_limits
     SET window_start_ms=window_start_ms-60000,request_count=30
   WHERE user_id=v_user_a AND bucket='market_data';
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'Expired-window fixture did not update exactly one existing row';
  END IF;
  v_result:=public.consume_paper_api_rate_limit(v_user_a,'market_data');
  IF v_result->>'allowed'<>'true'
     OR (v_result->>'remaining')::integer<>29 THEN
    RAISE EXCEPTION 'An expired window did not reset its request budget: %',v_result;
  END IF;
  SELECT count(*) INTO v_rows
    FROM public.paper_api_rate_limits
   WHERE user_id=v_user_a AND bucket='market_data';
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'Expired-window reset did not reuse exactly one bounded row';
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
