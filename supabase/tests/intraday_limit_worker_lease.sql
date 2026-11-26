-- Intraday LIMIT worker lease registration, exclusivity and release.
DO $intraday_worker_lease$
DECLARE
  v_now bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_first uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_second uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_result boolean;
BEGIN
  IF NOT has_function_privilege('service_role',
       'public.acquire_paper_market_worker_lease(text,uuid,bigint,bigint)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.acquire_paper_market_worker_lease(text,uuid,bigint,bigint)','EXECUTE')
     OR has_function_privilege('anon',
       'public.release_paper_market_worker_lease(text,uuid,bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'Market worker lease RPC grants are not service-role-only';
  END IF;

  UPDATE public.paper_market_worker_state
     SET lease_token=NULL,lease_expires_at=NULL,cursor_created_at=NULL,cursor_order_id=NULL
   WHERE state_key='paper_intraday_limit_orders';

  SELECT public.acquire_paper_market_worker_lease(
    'paper_intraday_limit_orders',v_first,v_now,240000
  ) INTO v_result;
  IF v_result IS NOT TRUE THEN
    RAISE EXCEPTION 'Intraday LIMIT worker could not acquire its registered lease key';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.paper_market_worker_state
     WHERE state_key='paper_intraday_limit_orders' AND lease_token=v_first
       AND lease_expires_at>clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'Intraday LIMIT worker lease row was not persisted';
  END IF;

  SELECT public.acquire_paper_market_worker_lease(
    'paper_intraday_limit_orders',v_second,v_now,240000
  ) INTO v_result;
  IF v_result IS NOT FALSE THEN
    RAISE EXCEPTION 'A second Intraday LIMIT worker acquired an active lease';
  END IF;

  SELECT public.release_paper_market_worker_lease(
    'paper_intraday_limit_orders',v_second,v_now
  ) INTO v_result;
  IF v_result IS NOT FALSE THEN
    RAISE EXCEPTION 'A non-owner released the Intraday LIMIT worker lease';
  END IF;

  SELECT public.release_paper_market_worker_lease(
    'paper_intraday_limit_orders',v_first,v_now
  ) INTO v_result;
  IF v_result IS NOT TRUE THEN
    RAISE EXCEPTION 'Intraday LIMIT worker could not release its own lease';
  END IF;

  SELECT public.acquire_paper_market_worker_lease(
    'paper_intraday_limit_orders',v_second,v_now,240000
  ) INTO v_result;
  IF v_result IS NOT TRUE THEN
    RAISE EXCEPTION 'Intraday LIMIT worker lease could not be reacquired after release';
  END IF;

  SELECT public.release_paper_market_worker_lease(
    'paper_intraday_limit_orders',v_second,v_now
  ) INTO v_result;
  IF v_result IS NOT TRUE THEN
    RAISE EXCEPTION 'Intraday LIMIT worker second lease could not be released';
  END IF;

  DELETE FROM public.paper_market_worker_state
   WHERE state_key='paper_intraday_limit_orders' AND lease_token IS NULL;
END
$intraday_worker_lease$;
