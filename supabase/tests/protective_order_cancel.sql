-- Focused owner-bound, idempotent cancellation tests for protective orders.
-- Uses the disposable PostgreSQL CI database only.

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
  v_result:=public.cancel_paper_protective_order('cacacaca-caca-4aca-8aca-cacacacacaca');
  IF v_result->>'status'<>'CANCELLED' OR (v_result->>'cancelled')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Owner could not cancel own active protective order';
  END IF;

  v_result:=public.cancel_paper_protective_order('cacacaca-caca-4aca-8aca-cacacacacaca');
  IF v_result->>'status'<>'CANCELLED' OR (v_result->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Repeated protective cancellation was not idempotent';
  END IF;

  v_result:=public.cancel_paper_protective_order('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd');
  IF v_result->>'status'<>'FILLED' OR (v_result->>'already_filled')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Filled protective order did not remain terminal';
  END IF;

  BEGIN
    PERFORM public.cancel_paper_protective_order('cbcbcbcb-cbcb-4bcb-8bcb-cbcbcbcbcbcb');
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
   'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
 );
