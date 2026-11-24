-- Disposable PostgreSQL security smoke test. Run only against the CI test database.
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('12121212-1212-4212-8212-121212121212'),
 ('34343434-3434-4434-8434-343434343434')
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.s_trade_notification_preferences(user_id,trade_confirmations,order_alerts,price_alerts)
VALUES ('12121212-1212-4212-8212-121212121212',true,false,true)
ON CONFLICT(user_id) DO UPDATE SET trade_confirmations=true,order_alerts=false,price_alerts=true;
INSERT INTO public.paper_orders(
 order_id,user_id,request_fingerprint,instrument_key,side,product,order_type,status,quantity
) VALUES
 (repeat('a',64),'12121212-1212-4212-8212-121212121212',repeat('1',64),'NSE_EQ|NOTIFY1','BUY','DELIVERY','MARKET','PENDING',1),
 (repeat('b',64),'34343434-3434-4434-8434-343434343434',repeat('2',64),'NSE_EQ|NOTIFY2','BUY','DELIVERY','MARKET','PENDING',1);
UPDATE public.paper_orders SET status='FILLED' WHERE order_id=repeat('a',64);
UPDATE public.paper_orders SET status='CANCELLED' WHERE order_id=repeat('b',64);
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
  IF v_count<>2 THEN RAISE EXCEPTION 'Notification tenant isolation or order confirmation failed: visible rows=%',v_count; END IF;
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
  INSERT INTO public.s_trade_price_alerts(user_id,instrument_key,display_symbol,condition,target_price)
  SELECT '12121212-1212-4212-8212-121212121212','NSE_EQ|CAP'||g,'CAP'||g,'above',10
    FROM generate_series(1,49) AS g;
  IF (SELECT count(*) FROM public.s_trade_price_alerts
       WHERE user_id='12121212-1212-4212-8212-121212121212' AND active)<>50 THEN
    RAISE EXCEPTION 'Price alert quota fixture did not create 50 active alerts';
  END IF;
  BEGIN
    INSERT INTO public.s_trade_price_alerts(user_id,instrument_key,display_symbol,condition,target_price)
    VALUES ('12121212-1212-4212-8212-121212121212','NSE_EQ|CAP51','CAP51','above',10);
    RAISE EXCEPTION '51st active price alert unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.s_trade_price_alerts(user_id,instrument_key,display_symbol,condition,target_price)
    VALUES ('34343434-3434-4434-8434-343434343434','NSE_EQ|INE002','OTHER','below',50);
    RAISE EXCEPTION 'Cross-tenant price alert insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$security$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $price_alert_evaluation$
DECLARE v_alert uuid;
BEGIN
  SELECT alert_id INTO v_alert FROM public.s_trade_price_alerts
   WHERE user_id='12121212-1212-4212-8212-121212121212' AND display_symbol='TEST' LIMIT 1;
  IF v_alert IS NULL OR NOT public.s_trade_evaluate_price_alert(v_alert,101) THEN
    RAISE EXCEPTION 'Price alert did not trigger at or above its target';
  END IF;
  IF public.s_trade_evaluate_price_alert(v_alert,102) THEN
    RAISE EXCEPTION 'One-shot price alert triggered more than once';
  END IF;
END;
$price_alert_evaluation$;
RESET ROLE;
DO $notification_assertions$
BEGIN
  IF (SELECT count(*) FROM public.s_trade_notifications
       WHERE user_id='12121212-1212-4212-8212-121212121212' AND event_type='trade_confirmation')<>1 THEN
    RAISE EXCEPTION 'Trade confirmation trigger did not create exactly one notification';
  END IF;
  IF (SELECT count(*) FROM public.s_trade_notifications
       WHERE user_id='12121212-1212-4212-8212-121212121212' AND event_type='order_alert')<>0 THEN
    RAISE EXCEPTION 'Disabled order alerts were not respected';
  END IF;
  IF (SELECT count(*) FROM public.s_trade_notifications
       WHERE user_id='34343434-3434-4434-8434-343434343434' AND event_type='order_alert')<>1 THEN
    RAISE EXCEPTION 'Default order alert was not generated';
  END IF;
  IF (SELECT count(*) FROM public.s_trade_notifications
       WHERE user_id='12121212-1212-4212-8212-121212121212' AND event_type='price_alert')<>1 THEN
    RAISE EXCEPTION 'Triggered price alert did not create exactly one notification';
  END IF;
END;
$notification_assertions$;

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
