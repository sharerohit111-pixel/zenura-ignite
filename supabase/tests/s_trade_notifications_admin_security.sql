-- Disposable PostgreSQL security smoke test. Run only against the CI test database.
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('12121212-1212-4212-8212-121212121212'),
 ('34343434-3434-4434-8434-343434343434')
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.s_trade_notifications(user_id,event_type,title,body)
VALUES
 ('12121212-1212-4212-8212-121212121212','system','Own notification','Own tenant only'),
 ('34343434-3434-4434-8434-343434343434','system','Other notification','Other tenant only');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','12121212-1212-4212-8212-121212121212',true);
DO $security$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.s_trade_notifications;
  IF v_count<>1 THEN RAISE EXCEPTION 'Notification tenant isolation failed: visible rows=%',v_count; END IF;
  IF has_table_privilege(current_user,'public.s_trade_admins','SELECT') THEN
    RAISE EXCEPTION 'Authenticated role unexpectedly has admin registry access';
  END IF;
  IF has_table_privilege(current_user,'public.s_trade_admin_audit_log','SELECT') THEN
    RAISE EXCEPTION 'Authenticated role unexpectedly has audit access';
  END IF;
  IF has_table_privilege(current_user,'public.s_trade_notifications','INSERT') THEN
    RAISE EXCEPTION 'Authenticated role can forge notifications';
  END IF;
  IF has_table_privilege(current_user,'public.s_trade_provider_health','SELECT') THEN
    RAISE EXCEPTION 'Authenticated role can read internal provider health';
  END IF;
  INSERT INTO public.s_trade_price_alerts(user_id,instrument_key,display_symbol,condition,target_price)
  VALUES ('12121212-1212-4212-8212-121212121212','NSE_EQ|INE001','TEST','above',100);
  BEGIN
    INSERT INTO public.s_trade_price_alerts(user_id,instrument_key,display_symbol,condition,target_price)
    VALUES ('34343434-3434-4434-8434-343434343434','NSE_EQ|INE002','OTHER','below',50);
    RAISE EXCEPTION 'Cross-tenant price alert insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$security$;
RESET ROLE;

DO $service_privileges$
BEGIN
  IF has_table_privilege('service_role','public.s_trade_admin_audit_log','UPDATE')
     OR has_table_privilege('service_role','public.s_trade_admin_audit_log','DELETE') THEN
    RAISE EXCEPTION 'Service role can mutate append-only admin audit history';
  END IF;
  IF has_table_privilege('anon','public.s_trade_admins','SELECT')
     OR has_table_privilege('authenticated','public.s_trade_admins','SELECT') THEN
    RAISE EXCEPTION 'Non-service role can inspect administrator registry';
  END IF;
  IF has_function_privilege('authenticated','public.s_trade_evaluate_price_alert(uuid,numeric)','EXECUTE')
     OR has_function_privilege('anon','public.s_trade_evaluate_price_alert(uuid,numeric)','EXECUTE') THEN
    RAISE EXCEPTION 'Untrusted role can execute the server price-alert evaluator';
  END IF;
  IF NOT has_function_privilege('service_role','public.s_trade_evaluate_price_alert(uuid,numeric)','EXECUTE') THEN
    RAISE EXCEPTION 'Service role cannot execute price-alert evaluator';
  END IF;
END;
$service_privileges$;
ROLLBACK;
