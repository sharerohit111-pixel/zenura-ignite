-- Focused owner-bound, idempotent cancellation tests for protective orders.
-- Uses the disposable PostgreSQL CI database only.

INSERT INTO public.paper_equity_positions(
  user_id,product,instrument_key,trading_symbol,exchange,quantity,average_price_paise,cost_basis_paise,reserved_quantity
) VALUES ('11111111-1111-4111-8111-111111111111','DELIVERY','NSE_EQ|CREATE_TEST','CREATE_TEST','NSE',10,9000,90000,2);

INSERT INTO public.paper_equity_positions(
  user_id,product,instrument_key,trading_symbol,exchange,quantity,average_price_paise,cost_basis_paise,reserved_quantity
) VALUES ('11111111-1111-4111-8111-111111111111','DELIVERY','NSE_EQ|CANCEL_OWN','CANCEL_OWN','NSE',10,9000,90000,1);

INSERT INTO public.paper_protective_orders(
  order_id,user_id,asset_class,instrument_key,product,side,
  trigger_type,trigger_direction,trigger_price_paise,quantity,status
) VALUES
  ('cacacaca-caca-4aca-8aca-cacacacacaca','11111111-1111-4111-8111-111111111111',
   'EQUITY','NSE_EQ|CANCEL_OWN','DELIVERY','SELL','STOP_LOSS','AT_OR_BELOW',9000,1,'ACTIVE'),
  ('cbcbcbcb-cbcb-4bcb-8bcb-cbcbcbcbcbcb','22222222-2222-4222-8222-222222222222',
   'EQUITY','NSE_EQ|CANCEL_OTHER','DELIVERY','SELL','STOP_LOSS','AT_OR_BELOW',9000,1,'TRIGGERED'),
  ('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd','11111111-1111-4111-8111-111111111111',
   'EQUITY','NSE_EQ|CANCEL_FILLED','DELIVERY','SELL','TARGET','AT_OR_ABOVE',11000,1,'FILLED');

SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',false);

DO $protective_cancel$
DECLARE
  v_result jsonb;
BEGIN
  v_result:=public.create_paper_equity_protective_order(
    'cececece-cece-4ece-8ece-cececececece','11111111-1111-4111-8111-111111111111',
    'NSE_EQ|CREATE_TEST','DELIVERY','STOP_LOSS',8500,4
  );
  IF v_result->'order'->>'status'<>'ACTIVE' OR (v_result->>'idempotent_replay')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Equity protective order was not created correctly';
  END IF;
  IF (SELECT reserved_quantity FROM public.paper_equity_positions
      WHERE user_id='11111111-1111-4111-8111-111111111111'
        AND product='DELIVERY' AND instrument_key='NSE_EQ|CREATE_TEST')<>6 THEN
    RAISE EXCEPTION 'Protective creation did not reserve shares exactly once';
  END IF;
  IF (SELECT quantity-reserved_quantity FROM public.paper_equity_positions
      WHERE user_id='11111111-1111-4111-8111-111111111111'
        AND product='DELIVERY' AND instrument_key='NSE_EQ|CREATE_TEST')<>4 THEN
    RAISE EXCEPTION 'Protective reservation did not leave the correct unreserved quantity';
  END IF;
  -- An idempotent retry must repeat the original request byte-for-byte,
  -- including quantity; changing details with the same ID must be rejected.
  v_result:=public.create_paper_equity_protective_order(
    'cececece-cece-4ece-8ece-cececececece','11111111-1111-4111-8111-111111111111',
    'NSE_EQ|CREATE_TEST','DELIVERY','STOP_LOSS',8500,4
  );
  IF (v_result->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Protective order creation replay was not idempotent';
  END IF;
  BEGIN
    PERFORM public.create_paper_equity_protective_order(
      'cececece-cece-4ece-8ece-cececececece','11111111-1111-4111-8111-111111111111',
      'NSE_EQ|CREATE_TEST','DELIVERY','STOP_LOSS',8500,8
    );
    RAISE EXCEPTION 'Protective order ID reuse with changed quantity was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  BEGIN
    PERFORM public.create_paper_equity_protective_order(
      'cfcfcfcf-cece-4ece-8ece-cececececece','11111111-1111-4111-8111-111111111111',
      'NSE_EQ|CREATE_TEST','DELIVERY','TARGET',11000,1
    );
    RAISE EXCEPTION 'Second live protective exit for the same equity position was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  BEGIN
    PERFORM public.create_paper_equity_protective_order(
      'cfcccccc-cece-4ece-8ece-cececececece','11111111-1111-4111-8111-111111111111',
      'NSE_EQ|CREATE_TEST','DELIVERY','STOP_LOSS',8500,5
    );
    RAISE EXCEPTION 'Protective order exceeded unreserved position quantity';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  v_result:=public.cancel_paper_protective_order('cacacaca-caca-4aca-8aca-cacacacacaca','11111111-1111-4111-8111-111111111111');
  IF v_result->>'status'<>'CANCELLED' OR (v_result->>'cancelled')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Owner could not cancel own active protective order';
  END IF;
  IF (SELECT reserved_quantity FROM public.paper_equity_positions
      WHERE user_id='11111111-1111-4111-8111-111111111111'
        AND product='DELIVERY' AND instrument_key='NSE_EQ|CANCEL_OWN')<>0 THEN
    RAISE EXCEPTION 'Protective cancellation did not release its share reservation';
  END IF;

  v_result:=public.cancel_paper_protective_order('cacacaca-caca-4aca-8aca-cacacacacaca','11111111-1111-4111-8111-111111111111');
  IF v_result->>'status'<>'CANCELLED' OR (v_result->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Repeated protective cancellation was not idempotent';
  END IF;

  v_result:=public.cancel_paper_protective_order('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd','11111111-1111-4111-8111-111111111111');
  IF v_result->>'status'<>'FILLED' OR (v_result->>'already_filled')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Filled protective order did not remain terminal';
  END IF;

  BEGIN
    PERFORM public.cancel_paper_protective_order('cbcbcbcb-cbcb-4bcb-8bcb-cbcbcbcbcbcb','11111111-1111-4111-8111-111111111111');
    RAISE EXCEPTION 'Cross-user protective cancellation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$protective_cancel$;
RESET ROLE;

DO $protective_cancel_assertions$
BEGIN
  IF (SELECT status FROM public.paper_protective_orders
      WHERE order_id='cacacaca-caca-4aca-8aca-cacacacacaca')<>'CANCELLED'
     OR (SELECT cancelled_at FROM public.paper_protective_orders
      WHERE order_id='cacacaca-caca-4aca-8aca-cacacacacaca') IS NULL THEN
    RAISE EXCEPTION 'Protective cancellation state/timestamp was not persisted';
  END IF;
  IF (SELECT status FROM public.paper_protective_orders
      WHERE order_id='cbcbcbcb-cbcb-4bcb-8bcb-cbcbcbcbcbcb')<>'TRIGGERED' THEN
    RAISE EXCEPTION 'Cross-user cancellation changed another user order';
  END IF;
  IF (SELECT status FROM public.paper_protective_orders
      WHERE order_id='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd')<>'FILLED' THEN
    RAISE EXCEPTION 'Cancellation changed a previously filled protective order';
  END IF;
END
$protective_cancel_assertions$;

DELETE FROM public.paper_protective_orders
 WHERE order_id IN (
   'cacacaca-caca-4aca-8aca-cacacacacaca',
   'cbcbcbcb-cbcb-4bcb-8bcb-cbcbcbcbcbcb',
   'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
   'cececece-cece-4ece-8ece-cececececece'
 );
DELETE FROM public.paper_equity_positions WHERE user_id='11111111-1111-4111-8111-111111111111' AND instrument_key='NSE_EQ|CREATE_TEST' AND product='DELIVERY';
DELETE FROM public.paper_equity_positions WHERE user_id='11111111-1111-4111-8111-111111111111' AND instrument_key='NSE_EQ|CANCEL_OWN' AND product='DELIVERY';
