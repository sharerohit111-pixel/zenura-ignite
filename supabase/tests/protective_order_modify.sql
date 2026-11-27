-- Disposable PostgreSQL contract test for authenticated protective-order modification.
-- This test never connects to hosted Supabase.
BEGIN;

INSERT INTO auth.users(id) VALUES
 ('a1010101-a101-4101-8101-a10101010101'),
 ('a2020202-a202-4202-8202-a20202020202')
ON CONFLICT(id) DO NOTHING;

INSERT INTO public.paper_equity_positions(
 user_id,product,instrument_key,trading_symbol,exchange,quantity,
 average_price_paise,cost_basis_paise,reserved_quantity
) VALUES (
 'a1010101-a101-4101-8101-a10101010101','DELIVERY',
 'NSE_EQ|MODIFY_TEST','MODIFY_TEST','NSE',10,10000,100000,4
);

INSERT INTO public.paper_protective_orders(
 order_id,user_id,asset_class,instrument_key,product,side,
 trigger_type,trigger_direction,trigger_price_paise,quantity,status
) VALUES (
 'a3030303-a303-4303-8303-a30303030303',
 'a1010101-a101-4101-8101-a10101010101','EQUITY',
 'NSE_EQ|MODIFY_TEST','DELIVERY','SELL',
 'STOP_LOSS','AT_OR_BELOW',9000,4,'ACTIVE'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
 '{"sub":"a1010101-a101-4101-8101-a10101010101","role":"authenticated"}',true);

DO $owner_modify$
DECLARE
 v_result jsonb;
 v_reserved integer;
BEGIN
 v_result:=public.modify_paper_equity_protective_order(
  'a3030303-a303-4303-8303-a30303030303',
  'a1010101-a101-4101-8101-a10101010101',
  'TARGET',12000,6
 );
 IF v_result->'order'->>'trigger_type'<>'TARGET'
    OR v_result->'order'->>'trigger_direction'<>'AT_OR_ABOVE'
    OR (v_result->'order'->>'quantity')::integer<>6
    OR (v_result->'order'->>'trigger_price_paise')::bigint<>12000 THEN
  RAISE EXCEPTION 'Protective order fields were not updated atomically';
 END IF;
 SELECT reserved_quantity INTO v_reserved FROM public.paper_equity_positions
  WHERE user_id='a1010101-a101-4101-8101-a10101010101'
    AND product='DELIVERY' AND instrument_key='NSE_EQ|MODIFY_TEST';
 IF v_reserved<>6 THEN RAISE EXCEPTION 'Increasing quantity did not reserve additional shares'; END IF;

 v_result:=public.modify_paper_equity_protective_order(
  'a3030303-a303-4303-8303-a30303030303',
  'a1010101-a101-4101-8101-a10101010101',
  'STOP_LOSS',8500,3
 );
 IF (v_result->'order'->>'quantity')::integer<>3 THEN
  RAISE EXCEPTION 'Protective order quantity reduction failed';
 END IF;
 SELECT reserved_quantity INTO v_reserved FROM public.paper_equity_positions
  WHERE user_id='a1010101-a101-4101-8101-a10101010101'
    AND product='DELIVERY' AND instrument_key='NSE_EQ|MODIFY_TEST';
 IF v_reserved<>3 THEN RAISE EXCEPTION 'Reducing quantity did not release excess shares'; END IF;

 v_result:=public.modify_paper_equity_protective_order(
  'a3030303-a303-4303-8303-a30303030303',
  'a1010101-a101-4101-8101-a10101010101',
  'STOP_LOSS',8500,3
 );
 IF (v_result->>'idempotent_replay')::boolean IS NOT TRUE THEN
  RAISE EXCEPTION 'Identical protective modification was not idempotent';
 END IF;
END
$owner_modify$;

SELECT set_config('request.jwt.claims',
 '{"sub":"a2020202-a202-4202-8202-a20202020202","role":"authenticated"}',true);
DO $tenant_guard$
BEGIN
 BEGIN
  PERFORM public.modify_paper_equity_protective_order(
   'a3030303-a303-4303-8303-a30303030303',
   'a2020202-a202-4202-8202-a20202020202',
   'TARGET',13000,2
  );
  RAISE EXCEPTION 'Cross-user protective modification unexpectedly succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END
$tenant_guard$;

RESET ROLE;
ROLLBACK;
