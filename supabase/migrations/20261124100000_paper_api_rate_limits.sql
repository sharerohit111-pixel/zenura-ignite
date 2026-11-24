-- Distributed per-user API request budgets for the Supabase market gateway.
-- One reusable row per authenticated user and fixed bucket; no per-request history.
CREATE TABLE IF NOT EXISTS public.paper_api_rate_limits (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bucket text NOT NULL CHECK (bucket IN (
    'market_data','paper_read','paper_write','account_read','account_write','oauth'
  )),
  window_start_ms bigint NOT NULL CHECK (window_start_ms >= 0),
  request_count integer NOT NULL CHECK (request_count >= 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id,bucket)
);

ALTER TABLE public.paper_api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.paper_api_rate_limits FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.consume_paper_api_rate_limit(
  p_user_id uuid,
  p_bucket text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_limit integer;
  v_window_ms bigint;
  v_now_ms bigint;
  v_window_start_ms bigint;
  v_count integer;
  v_stored_window_ms bigint;
  v_retry integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Rate-limit user is required' USING ERRCODE='22023';
  END IF;

  CASE p_bucket
    WHEN 'market_data' THEN v_limit:=30; v_window_ms:=60000;
    WHEN 'paper_read' THEN v_limit:=120; v_window_ms:=60000;
    WHEN 'paper_write' THEN v_limit:=30; v_window_ms:=60000;
    WHEN 'account_read' THEN v_limit:=60; v_window_ms:=60000;
    WHEN 'account_write' THEN v_limit:=20; v_window_ms:=60000;
    WHEN 'oauth' THEN v_limit:=5; v_window_ms:=300000;
    ELSE RAISE EXCEPTION 'Unsupported API rate-limit bucket' USING ERRCODE='22023';
  END CASE;

  -- Use database time, not gateway instance clocks, for a consistent distributed window.
  v_now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  v_window_start_ms:=(v_now_ms/v_window_ms)*v_window_ms;

  INSERT INTO public.paper_api_rate_limits(
    user_id,bucket,window_start_ms,request_count,updated_at
  ) VALUES (
    p_user_id,p_bucket,v_window_start_ms,1,clock_timestamp()
  )
  ON CONFLICT(user_id,bucket) DO UPDATE SET
    window_start_ms=EXCLUDED.window_start_ms,
    request_count=CASE
      WHEN public.paper_api_rate_limits.window_start_ms<EXCLUDED.window_start_ms THEN 1
      ELSE public.paper_api_rate_limits.request_count+1
    END,
    updated_at=clock_timestamp()
  WHERE public.paper_api_rate_limits.window_start_ms<EXCLUDED.window_start_ms
     OR (
       public.paper_api_rate_limits.window_start_ms=EXCLUDED.window_start_ms
       AND public.paper_api_rate_limits.request_count<v_limit
     )
  RETURNING request_count INTO v_count;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'allowed',true,'remaining',greatest(v_limit-v_count,0),
      'retry_after_seconds',0,'bucket',p_bucket
    );
  END IF;

  SELECT request_count,window_start_ms
    INTO v_count,v_stored_window_ms
    FROM public.paper_api_rate_limits
   WHERE user_id=p_user_id AND bucket=p_bucket;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rate-limit state could not be read' USING ERRCODE='55000';
  END IF;

  v_retry:=greatest(1,ceil((v_stored_window_ms+v_window_ms-v_now_ms)/1000.0)::integer);
  RETURN jsonb_build_object(
    'allowed',false,'remaining',0,
    'retry_after_seconds',v_retry,'bucket',p_bucket
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_paper_api_rate_limit(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_paper_api_rate_limit(uuid,text) TO service_role;
