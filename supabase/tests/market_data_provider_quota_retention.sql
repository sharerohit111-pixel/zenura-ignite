DO $quota_retention_smoke$
DECLARE
  v_now_ms bigint := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_cutoff bigint;
  v_deleted integer;
  v_remaining integer;
BEGIN
  v_cutoff := v_now_ms - 86400000;

  INSERT INTO public.market_data_provider_quota_policies(
    provider_id,operation,provider_account_key,provider_capacity,provider_window_ms,
    user_capacity,user_window_ms,enabled
  ) VALUES ('quota-retention','quote','quota-retention-account',10,60000,10,60000,true);

  INSERT INTO public.market_data_provider_quota_buckets(
    provider_id,operation,quota_scope,scope_key,window_start_ms,used,updated_at
  ) VALUES
    ('quota-retention','quote','account','quota-retention-account',v_cutoff-120000,1,to_timestamp((v_cutoff-60000)::numeric/1000)),
    ('quota-retention','quote','user','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',v_cutoff-120000,1,clock_timestamp()),
    ('quota-retention','quote','account','quota-retention-account',v_now_ms-60000,1,clock_timestamp());

  BEGIN
    PERFORM public.prune_market_data_provider_quota_buckets(v_now_ms-1000,100);
    RAISE EXCEPTION 'Recent quota retention cutoff unexpectedly accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  v_deleted := public.prune_market_data_provider_quota_buckets(v_cutoff,1);
  IF v_deleted<>1 THEN
    RAISE EXCEPTION 'Expected bounded quota cleanup to delete exactly one row, got %',v_deleted;
  END IF;

  SELECT count(*) INTO v_remaining
    FROM public.market_data_provider_quota_buckets
   WHERE provider_id='quota-retention' AND operation='quote';
  IF v_remaining<>2 THEN
    RAISE EXCEPTION 'Quota cleanup removed a recent or active window; rows remaining %',v_remaining;
  END IF;

  v_deleted := public.prune_market_data_provider_quota_buckets(v_cutoff,100);
  IF v_deleted<>0 THEN
    RAISE EXCEPTION 'Cleanup must preserve recently updated and active buckets, got %',v_deleted;
  END IF;

  DELETE FROM public.market_data_provider_quota_policies
   WHERE provider_id='quota-retention' AND operation='quote';
END
$quota_retention_smoke$;
