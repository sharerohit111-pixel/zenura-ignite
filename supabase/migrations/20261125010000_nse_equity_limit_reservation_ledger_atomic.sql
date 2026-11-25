-- Integration candidate: version advanced to 20261125010000 to avoid collision
-- with the existing 20261123180000 Options LIMIT schema migration.
-- Atomic cash reservation lifecycle audit for NSE Equity LIMIT orders.
-- All entries are committed/rolled back with the existing reservation RPC.
-- Share reservations for SELL orders are position reservations, not cash ledger events.

ALTER FUNCTION public.submit_paper_limit_order(uuid,text,uuid,text,text,text,text,text,integer,bigint)
  RENAME TO _submit_paper_limit_order_without_ledger;
ALTER FUNCTION public.cancel_paper_limit_order(uuid,text)
  RENAME TO _cancel_paper_limit_order_without_ledger;
ALTER FUNCTION public.submit_paper_intraday_limit_order(uuid,text,uuid,text,text,text,text,text,integer,bigint)
  RENAME TO _submit_paper_intraday_limit_order_without_ledger;
ALTER FUNCTION public.cancel_paper_intraday_limit_order(uuid,text)
  RENAME TO _cancel_paper_intraday_limit_order_without_ledger;
ALTER FUNCTION public.expire_paper_intraday_limit_orders(integer)
  RENAME TO _expire_paper_intraday_limit_orders_without_ledger;

REVOKE ALL ON FUNCTION public._submit_paper_limit_order_without_ledger(uuid,text,uuid,text,text,text,text,text,integer,bigint)
  FROM public,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._cancel_paper_limit_order_without_ledger(uuid,text)
  FROM public,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._submit_paper_intraday_limit_order_without_ledger(uuid,text,uuid,text,text,text,text,text,integer,bigint)
  FROM public,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._cancel_paper_intraday_limit_order_without_ledger(uuid,text)
  FROM public,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._expire_paper_intraday_limit_orders_without_ledger(integer)
  FROM public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.submit_paper_limit_order(
  p_user_id uuid,p_order_id text,p_idempotency_key uuid,p_request_fingerprint text,
  p_instrument_key text,p_trading_symbol text,p_exchange text,p_side text,
  p_quantity integer,p_limit_price_paise bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_result jsonb;
  v_order public.paper_orders%rowtype;
  v_account public.paper_accounts%rowtype;
BEGIN
  v_result:=public._submit_paper_limit_order_without_ledger(
    p_user_id,p_order_id,p_idempotency_key,p_request_fingerprint,
    p_instrument_key,p_trading_symbol,p_exchange,p_side,p_quantity,p_limit_price_paise
  );
  IF coalesce((v_result->>'idempotent_replay')::boolean,false) THEN
    RETURN v_result;
  END IF;
  SELECT * INTO v_order FROM public.paper_orders WHERE order_id=p_order_id AND user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'LIMIT order missing after successful submission'; END IF;
  IF v_order.side='BUY' AND v_order.reserved_cash_paise>0 THEN
    SELECT * INTO v_account FROM public.paper_accounts WHERE user_id=p_user_id;
    INSERT INTO public.paper_equity_cash_ledger(
      user_id,order_id,event_key,event_type,cash_delta_paise,reserved_cash_delta_paise,
      cash_balance_after_paise,reserved_cash_after_paise,metadata
    ) VALUES (
      p_user_id,p_order_id,'limit-reserve-create:'||p_order_id,'RESERVATION_CREATE',
      0,v_order.reserved_cash_paise,v_account.cash_paise,v_account.reserved_cash_paise,
      jsonb_build_object('product','DELIVERY','side','BUY','simulation_only',true)
    );
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_paper_limit_order(p_user_id uuid,p_order_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_before public.paper_orders%rowtype;
  v_result jsonb;
  v_account public.paper_accounts%rowtype;
  v_had_order boolean:=false;
BEGIN
  SELECT * INTO v_before FROM public.paper_orders
   WHERE order_id=p_order_id AND user_id=p_user_id;
  v_had_order:=FOUND;
  v_result:=public._cancel_paper_limit_order_without_ledger(p_user_id,p_order_id);
  IF v_had_order AND v_before.status='PENDING' AND v_before.side='BUY'
     AND v_before.reserved_cash_paise>0
     AND v_result->>'status'='CANCELLED' THEN
    SELECT * INTO v_account FROM public.paper_accounts WHERE user_id=p_user_id;
    INSERT INTO public.paper_equity_cash_ledger(
      user_id,order_id,event_key,event_type,cash_delta_paise,reserved_cash_delta_paise,
      cash_balance_after_paise,reserved_cash_after_paise,metadata
    ) VALUES (
      p_user_id,p_order_id,'limit-reserve-release:'||p_order_id,'RESERVATION_RELEASE',
      0,-v_before.reserved_cash_paise,v_account.cash_paise,v_account.reserved_cash_paise,
      jsonb_build_object('product','DELIVERY','side','BUY','reason','USER_CANCEL','simulation_only',true)
    ) ON CONFLICT (user_id,event_key) DO NOTHING;
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_paper_intraday_limit_order(
  p_user_id uuid,p_order_id text,p_idempotency_key uuid,p_request_fingerprint text,
  p_instrument_key text,p_trading_symbol text,p_exchange text,p_side text,
  p_quantity integer,p_limit_price_paise bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_result jsonb;
  v_order public.paper_orders%rowtype;
  v_account public.paper_accounts%rowtype;
BEGIN
  v_result:=public._submit_paper_intraday_limit_order_without_ledger(
    p_user_id,p_order_id,p_idempotency_key,p_request_fingerprint,
    p_instrument_key,p_trading_symbol,p_exchange,p_side,p_quantity,p_limit_price_paise
  );
  IF coalesce((v_result->>'idempotent_replay')::boolean,false) THEN RETURN v_result; END IF;
  SELECT * INTO v_order FROM public.paper_orders WHERE order_id=p_order_id AND user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Intraday LIMIT order missing after successful submission'; END IF;
  IF v_order.side='BUY' AND v_order.reserved_cash_paise>0 THEN
    SELECT * INTO v_account FROM public.paper_accounts WHERE user_id=p_user_id;
    INSERT INTO public.paper_equity_cash_ledger(
      user_id,order_id,event_key,event_type,cash_delta_paise,reserved_cash_delta_paise,
      cash_balance_after_paise,reserved_cash_after_paise,metadata
    ) VALUES (
      p_user_id,p_order_id,'intraday-limit-reserve-create:'||p_order_id,'RESERVATION_CREATE',
      0,v_order.reserved_cash_paise,v_account.cash_paise,v_account.reserved_cash_paise,
      jsonb_build_object('product','INTRADAY','side','BUY','simulation_only',true)
    );
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_paper_intraday_limit_order(p_user_id uuid,p_order_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_before public.paper_orders%rowtype;
  v_result jsonb;
  v_account public.paper_accounts%rowtype;
  v_had_order boolean:=false;
BEGIN
  SELECT * INTO v_before FROM public.paper_orders
   WHERE order_id=p_order_id AND user_id=p_user_id AND product='INTRADAY' AND order_type='LIMIT';
  v_had_order:=FOUND;
  v_result:=public._cancel_paper_intraday_limit_order_without_ledger(p_user_id,p_order_id);
  IF v_had_order AND v_before.status='PENDING' AND v_before.side='BUY'
     AND v_before.reserved_cash_paise>0
     AND v_result->>'status'='CANCELLED' THEN
    SELECT * INTO v_account FROM public.paper_accounts WHERE user_id=p_user_id;
    INSERT INTO public.paper_equity_cash_ledger(
      user_id,order_id,event_key,event_type,cash_delta_paise,reserved_cash_delta_paise,
      cash_balance_after_paise,reserved_cash_after_paise,metadata
    ) VALUES (
      p_user_id,p_order_id,'intraday-limit-reserve-release:'||p_order_id,'RESERVATION_RELEASE',
      0,-v_before.reserved_cash_paise,v_account.cash_paise,v_account.reserved_cash_paise,
      jsonb_build_object('product','INTRADAY','side','BUY','reason','USER_CANCEL','simulation_only',true)
    ) ON CONFLICT (user_id,event_key) DO NOTHING;
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_paper_intraday_limit_orders(p_batch_size integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_before record;
  v_result integer;
  v_account public.paper_accounts%rowtype;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _equity_intraday_expiry_snapshot(
    order_id text PRIMARY KEY,user_id uuid NOT NULL,reserved_cash_paise bigint NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE TABLE _equity_intraday_expiry_snapshot;
  INSERT INTO _equity_intraday_expiry_snapshot(order_id,user_id,reserved_cash_paise)
  SELECT order_id,user_id,reserved_cash_paise FROM public.paper_orders
   WHERE product='INTRADAY' AND order_type='LIMIT' AND status='PENDING'
     AND side='BUY' AND reserved_cash_paise>0
   ORDER BY created_at,order_id;

  v_result:=public._expire_paper_intraday_limit_orders_without_ledger(p_batch_size);
  FOR v_before IN SELECT * FROM _equity_intraday_expiry_snapshot LOOP
    IF EXISTS(SELECT 1 FROM public.paper_orders
       WHERE order_id=v_before.order_id AND user_id=v_before.user_id
         AND status='CANCELLED' AND reservation_released IS TRUE) THEN
      SELECT * INTO v_account FROM public.paper_accounts WHERE user_id=v_before.user_id;
      INSERT INTO public.paper_equity_cash_ledger(
        user_id,order_id,event_key,event_type,cash_delta_paise,reserved_cash_delta_paise,
        cash_balance_after_paise,reserved_cash_after_paise,metadata
      ) VALUES (
        v_before.user_id,v_before.order_id,
        'intraday-limit-reserve-release:'||v_before.order_id,'RESERVATION_RELEASE',
        0,-v_before.reserved_cash_paise,v_account.cash_paise,v_account.reserved_cash_paise,
        jsonb_build_object('product','INTRADAY','side','BUY','reason','SESSION_EXPIRY','simulation_only',true)
      ) ON CONFLICT (user_id,event_key) DO NOTHING;
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_paper_limit_order(uuid,text,uuid,text,text,text,text,text,integer,bigint)
  FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_paper_limit_order(uuid,text)
  FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.submit_paper_intraday_limit_order(uuid,text,uuid,text,text,text,text,text,integer,bigint)
  FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_paper_intraday_limit_order(uuid,text)
  FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.expire_paper_intraday_limit_orders(integer)
  FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_paper_limit_order(uuid,text,uuid,text,text,text,text,text,integer,bigint),
  public.cancel_paper_limit_order(uuid,text),
  public.submit_paper_intraday_limit_order(uuid,text,uuid,text,text,text,text,text,integer,bigint),
  public.cancel_paper_intraday_limit_order(uuid,text),
  public.expire_paper_intraday_limit_orders(integer) TO service_role;
