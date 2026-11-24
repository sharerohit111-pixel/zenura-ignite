-- S-TRADE notifications, price alerts, admin governance and operational controls.
-- Draft-only migration. Never apply to production without reviewed staging rehearsal.

-- No application endpoint can grant administrator access. Seed the first administrator
-- through a separately reviewed, privileged database operation with a documented reason.
CREATE TABLE IF NOT EXISTS public.s_trade_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  granted_by uuid REFERENCES auth.users(id),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 8 AND 500)
);

CREATE TABLE IF NOT EXISTS public.s_trade_notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_confirmations boolean NOT NULL DEFAULT true,
  order_alerts boolean NOT NULL DEFAULT true,
  price_alerts boolean NOT NULL DEFAULT true,
  security_alerts boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT false,
  push_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.s_trade_notifications (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('trade_confirmation','order_alert','price_alert','security_alert','system')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data)='object'),
  source_table text,
  source_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz,
  UNIQUE(user_id,source_table,source_id,event_type)
);
CREATE INDEX IF NOT EXISTS s_trade_notifications_user_created_idx
  ON public.s_trade_notifications(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.s_trade_price_alerts (
  alert_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instrument_key text NOT NULL CHECK (length(instrument_key) BETWEEN 1 AND 100),
  display_symbol text NOT NULL CHECK (length(display_symbol) BETWEEN 1 AND 40),
  condition text NOT NULL CHECK (condition IN ('above','below')),
  target_price numeric(20,6) NOT NULL CHECK (target_price > 0 AND target_price < 1000000000000),
  active boolean NOT NULL DEFAULT true,
  triggered_at timestamptz,
  last_observed_price numeric(20,6),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS s_trade_price_alerts_active_instrument_idx
  ON public.s_trade_price_alerts(instrument_key,condition,target_price) WHERE active=true;

-- Enforce a per-user cap atomically; route-level count checks are only an early UX guard.
CREATE OR REPLACE FUNCTION public.s_trade_enforce_price_alert_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $
DECLARE v_active_count integer;
BEGIN
  IF NOT NEW.active THEN RETURN NEW; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.user_id::text,20261124)
  );
  SELECT count(*) INTO v_active_count FROM public.s_trade_price_alerts
   WHERE user_id=NEW.user_id AND active=true
     AND alert_id IS DISTINCT FROM NEW.alert_id;
  IF v_active_count>=50 THEN
    RAISE EXCEPTION 'Maximum 50 active price alerts per account' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$;
DROP TRIGGER IF EXISTS s_trade_price_alert_cap ON public.s_trade_price_alerts;
CREATE TRIGGER s_trade_price_alert_cap BEFORE INSERT OR UPDATE OF active
  ON public.s_trade_price_alerts FOR EACH ROW
  EXECUTE FUNCTION public.s_trade_enforce_price_alert_cap();
REVOKE ALL ON FUNCTION public.s_trade_enforce_price_alert_cap() FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.s_trade_provider_health (
  provider text PRIMARY KEY CHECK (provider IN ('upstox')),
  status text NOT NULL CHECK (status IN ('healthy','degraded','down','unknown')),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms BETWEEN 0 AND 120000),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  safe_message text NOT NULL DEFAULT '',
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.s_trade_operational_controls (
  control_key text PRIMARY KEY CHECK (control_key IN ('new_orders_enabled','price_alerts_enabled','provider_upstox_enabled')),
  enabled boolean NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 8 AND 500),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.s_trade_admin_audit_log (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  target_type text NOT NULL CHECK (length(target_type) BETWEEN 1 AND 80),
  target_id text,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 8 AND 500),
  outcome text NOT NULL CHECK (outcome IN ('requested','succeeded','failed','denied')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS s_trade_admin_audit_created_idx
  ON public.s_trade_admin_audit_log(created_at DESC);

ALTER TABLE public.s_trade_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.s_trade_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.s_trade_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.s_trade_price_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.s_trade_provider_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.s_trade_operational_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.s_trade_admin_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.s_trade_admins,public.s_trade_notification_preferences,
  public.s_trade_notifications,public.s_trade_price_alerts,public.s_trade_provider_health,
  public.s_trade_operational_controls,public.s_trade_admin_audit_log FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.s_trade_notification_preferences,
  public.s_trade_notifications,public.s_trade_price_alerts TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.s_trade_provider_health,
  public.s_trade_operational_controls TO service_role;
GRANT SELECT ON public.s_trade_admins TO service_role;
GRANT SELECT,INSERT ON public.s_trade_admin_audit_log TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.s_trade_admin_audit_log_audit_id_seq TO service_role;
GRANT SELECT ON public.s_trade_notification_preferences TO authenticated;
GRANT SELECT,UPDATE(read_at) ON public.s_trade_notifications TO authenticated;
GRANT SELECT ON public.s_trade_price_alerts TO authenticated;

CREATE POLICY s_trade_preferences_select_own ON public.s_trade_notification_preferences
  FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);
CREATE POLICY s_trade_notifications_select_own ON public.s_trade_notifications
  FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);
CREATE POLICY s_trade_notifications_mark_read_own ON public.s_trade_notifications
  FOR UPDATE TO authenticated USING ((SELECT auth.uid())=user_id)
  WITH CHECK ((SELECT auth.uid())=user_id);
CREATE POLICY s_trade_price_alerts_select_own ON public.s_trade_price_alerts
  FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);

CREATE OR REPLACE FUNCTION public.s_trade_reject_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION 'S-TRADE audit log is append-only' USING ERRCODE='55000';
END;
$$;
DROP TRIGGER IF EXISTS s_trade_audit_append_only ON public.s_trade_admin_audit_log;
CREATE TRIGGER s_trade_audit_append_only BEFORE UPDATE OR DELETE ON public.s_trade_admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.s_trade_reject_audit_mutation();

CREATE OR REPLACE FUNCTION public.s_trade_audit_admin_registry_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $
DECLARE v_actor uuid;
DECLARE v_target uuid;
DECLARE v_reason text;
DECLARE v_action text;
BEGIN
  IF TG_OP='INSERT' THEN
    v_actor:=nullif(current_setting('s_trade.actor_user_id',true),'')::uuid;
    IF v_actor IS NULL THEN v_actor:=NEW.granted_by; END IF;
    v_target:=NEW.user_id;v_reason:=NEW.reason;v_action:='admin_grant';
  ELSE
    v_actor:=nullif(current_setting('s_trade.actor_user_id',true),'')::uuid;
    IF v_actor IS NULL THEN v_actor:=OLD.granted_by; END IF;
    v_target:=OLD.user_id;v_reason:=OLD.reason;v_action:='admin_revoke';
  END IF;
  INSERT INTO public.s_trade_admin_audit_log(
    actor_user_id,action,target_type,target_id,reason,outcome,metadata
  ) VALUES (
    v_actor,v_action,'admin',v_target::text,v_reason,'succeeded',
    jsonb_build_object('source','privileged_database_operation')
  );
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$;
DROP TRIGGER IF EXISTS s_trade_admin_registry_audit ON public.s_trade_admins;
CREATE TRIGGER s_trade_admin_registry_audit AFTER INSERT OR DELETE ON public.s_trade_admins
  FOR EACH ROW EXECUTE FUNCTION public.s_trade_audit_admin_registry_change();

CREATE OR REPLACE FUNCTION public.s_trade_notify_order_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_user_id uuid;
  v_status text;
  v_old_status text;
  v_order_id text;
  v_event text;
  v_title text;
  v_body text;
  v_alerts_enabled boolean;
  v_trades_enabled boolean;
BEGIN
  v_user_id := (to_jsonb(NEW)->>'user_id')::uuid;
  v_status := upper(coalesce(to_jsonb(NEW)->>'status',''));
  v_old_status := CASE WHEN TG_OP='INSERT' THEN NULL ELSE upper(coalesce(to_jsonb(OLD)->>'status','')) END;
  v_order_id := coalesce(to_jsonb(NEW)->>'order_id',to_jsonb(NEW)->>'id');
  IF v_user_id IS NULL OR v_status=v_old_status OR v_status NOT IN ('FILLED','PARTIALLY_FILLED','CANCELLED','REJECTED','EXPIRED') THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(order_alerts,true),coalesce(trade_confirmations,true)
    INTO v_alerts_enabled,v_trades_enabled FROM public.s_trade_notification_preferences WHERE user_id=v_user_id;
  IF NOT FOUND THEN v_alerts_enabled:=true; v_trades_enabled:=true; END IF;
  IF (v_status='FILLED' AND NOT v_trades_enabled)
    OR (v_status<>'FILLED' AND NOT v_alerts_enabled) THEN RETURN NEW; END IF;
  v_event := CASE WHEN v_status='FILLED' THEN 'trade_confirmation' ELSE 'order_alert' END;
  v_title := CASE v_status WHEN 'FILLED' THEN 'Trade confirmed'
    WHEN 'PARTIALLY_FILLED' THEN 'Order partially filled'
    WHEN 'CANCELLED' THEN 'Order cancelled' WHEN 'EXPIRED' THEN 'Order expired' ELSE 'Order rejected' END;
  v_body := 'Your simulated order status is now '||lower(replace(v_status,'_',' '))||'.';
  INSERT INTO public.s_trade_notifications(user_id,event_type,title,body,data,source_table,source_id)
  VALUES(v_user_id,v_event,v_title,v_body,jsonb_build_object('orderId',v_order_id,'status',v_status),TG_TABLE_NAME,v_order_id)
  ON CONFLICT(user_id,source_table,source_id,event_type) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS s_trade_paper_order_notification ON public.paper_orders;
CREATE TRIGGER s_trade_paper_order_notification AFTER INSERT OR UPDATE ON public.paper_orders
  FOR EACH ROW EXECUTE FUNCTION public.s_trade_notify_order_event();
DROP TRIGGER IF EXISTS s_trade_derivative_order_notification ON public.paper_derivative_orders;
CREATE TRIGGER s_trade_derivative_order_notification AFTER INSERT OR UPDATE ON public.paper_derivative_orders
  FOR EACH ROW EXECUTE FUNCTION public.s_trade_notify_order_event();

CREATE OR REPLACE FUNCTION public.s_trade_evaluate_price_alert(
  p_alert_id uuid,p_observed_price numeric
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_alert public.s_trade_price_alerts%ROWTYPE;
DECLARE v_enabled boolean;
DECLARE v_alerts_globally_enabled boolean;
BEGIN
  IF p_alert_id IS NULL OR p_observed_price IS NULL OR p_observed_price<=0 OR p_observed_price>=1000000000000 THEN
    RAISE EXCEPTION 'Invalid price alert observation' USING ERRCODE='22023';
  END IF;
  SELECT enabled INTO v_alerts_globally_enabled FROM public.s_trade_operational_controls
   WHERE control_key='price_alerts_enabled';
  IF FOUND AND NOT v_alerts_globally_enabled THEN RETURN false; END IF;
  SELECT * INTO v_alert FROM public.s_trade_price_alerts
   WHERE alert_id=p_alert_id AND active=true FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.s_trade_price_alerts SET last_observed_price=p_observed_price,updated_at=clock_timestamp()
   WHERE alert_id=p_alert_id;
  IF NOT ((v_alert.condition='above' AND p_observed_price>=v_alert.target_price)
       OR (v_alert.condition='below' AND p_observed_price<=v_alert.target_price)) THEN
    RETURN false;
  END IF;
  SELECT coalesce(price_alerts,true) INTO v_enabled
    FROM public.s_trade_notification_preferences WHERE user_id=v_alert.user_id;
  IF coalesce(v_enabled,true) THEN
    INSERT INTO public.s_trade_notifications(user_id,event_type,title,body,data,source_table,source_id)
    VALUES(v_alert.user_id,'price_alert','Price alert triggered',
      v_alert.display_symbol||' reached your target price.',
      jsonb_build_object('instrumentKey',v_alert.instrument_key,'price',p_observed_price,'target',v_alert.target_price),
      's_trade_price_alerts',v_alert.alert_id::text)
    ON CONFLICT(user_id,source_table,source_id,event_type) DO NOTHING;
  END IF;
  UPDATE public.s_trade_price_alerts SET active=false,triggered_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE alert_id=p_alert_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.s_trade_reject_audit_mutation() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.s_trade_audit_admin_registry_change() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.s_trade_notify_order_event() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.s_trade_evaluate_price_alert(uuid,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.s_trade_evaluate_price_alert(uuid,numeric) TO service_role;

-- Atomic provider health heartbeat. Only the server service role can report health.
CREATE OR REPLACE FUNCTION public.s_trade_record_provider_health(
  p_provider text,p_ok boolean,p_latency_ms integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_provider<>'upstox' OR p_ok IS NULL OR p_latency_ms IS NULL
    OR p_latency_ms<0 OR p_latency_ms>120000 THEN
    RAISE EXCEPTION 'Invalid provider health observation' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.s_trade_provider_health(
    provider,status,latency_ms,last_success_at,last_failure_at,consecutive_failures,safe_message,checked_at
  ) VALUES (
    p_provider,CASE WHEN p_ok THEN 'healthy' ELSE 'degraded' END,p_latency_ms,
    CASE WHEN p_ok THEN clock_timestamp() ELSE NULL END,
    CASE WHEN p_ok THEN NULL ELSE clock_timestamp() END,
    CASE WHEN p_ok THEN 0 ELSE 1 END,
    CASE WHEN p_ok THEN 'Provider request succeeded' ELSE 'Provider request failed' END,
    clock_timestamp()
  )
  ON CONFLICT(provider) DO UPDATE SET
    status=CASE WHEN EXCLUDED.status='healthy' THEN 'healthy'
      WHEN public.s_trade_provider_health.consecutive_failures+1>=3 THEN 'down' ELSE 'degraded' END,
    latency_ms=EXCLUDED.latency_ms,
    last_success_at=CASE WHEN p_ok THEN EXCLUDED.last_success_at ELSE public.s_trade_provider_health.last_success_at END,
    last_failure_at=CASE WHEN p_ok THEN public.s_trade_provider_health.last_failure_at ELSE EXCLUDED.last_failure_at END,
    consecutive_failures=CASE WHEN p_ok THEN 0 ELSE public.s_trade_provider_health.consecutive_failures+1 END,
    safe_message=EXCLUDED.safe_message,checked_at=clock_timestamp();
END;
$$;
REVOKE ALL ON FUNCTION public.s_trade_record_provider_health(text,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.s_trade_record_provider_health(text,boolean,integer) TO service_role;

-- Extend event-driven confirmations to the existing Futures and Options LIMIT order lifecycles.
DROP TRIGGER IF EXISTS s_trade_futures_order_notification ON public.paper_futures_orders;
CREATE TRIGGER s_trade_futures_order_notification AFTER INSERT OR UPDATE ON public.paper_futures_orders
  FOR EACH ROW EXECUTE FUNCTION public.s_trade_notify_order_event();
DROP TRIGGER IF EXISTS s_trade_option_limit_order_notification ON public.paper_option_limit_orders;
CREATE TRIGGER s_trade_option_limit_order_notification AFTER INSERT OR UPDATE ON public.paper_option_limit_orders
  FOR EACH ROW EXECUTE FUNCTION public.s_trade_notify_order_event();
