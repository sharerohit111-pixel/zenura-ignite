-- Crypto SL/Target plan reservations share the position reservation pool with LIMIT SELL.
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('31313131-3131-4131-8131-313131313131'),
 ('41414141-4141-4141-8141-414141414141')
ON CONFLICT DO NOTHING;
INSERT INTO public.paper_crypto_accounts(user_id,currency,starting_cash,cash_balance)
VALUES ('31313131-3131-4131-8131-313131313131','INR',1000000,1000000);
INSERT INTO public.paper_crypto_positions(user_id,symbol,base_asset,quantity,reserved_quantity,average_entry_price,cost_basis)
VALUES ('31313131-3131-4131-8131-313131313131','BTCUSDT','BTC',1,0.2,50000,50000);
SET ROLE service_role;
SELECT public.create_paper_crypto_risk_plan(
 '31313131-3131-4131-8131-313131313131',
 '32323232-3232-4232-8232-323232323232',
 '33333333-3333-4333-8333-333333333333',
 'BTCUSDT','BTC',0.5,45000,60000
);
SELECT public.create_paper_crypto_risk_plan(
 '31313131-3131-4131-8131-313131313131',
 '32323232-3232-4232-8232-323232323232',
 '33333333-3333-4333-8333-333333333333',
 'BTCUSDT','BTC',0.5,45000,60000
);
DO $$
DECLARE v_reserved numeric; v_failed boolean:=false;
BEGIN
 SELECT reserved_quantity INTO v_reserved FROM public.paper_crypto_positions
 WHERE user_id='31313131-3131-4131-8131-313131313131' AND symbol='BTCUSDT';
 IF v_reserved<>0.7 THEN RAISE EXCEPTION 'Risk plan did not reserve exactly 0.5 additional BTC: %',v_reserved; END IF;
 BEGIN
  PERFORM public.create_paper_crypto_risk_plan(
   '31313131-3131-4131-8131-313131313131',
   '34343434-3434-4434-8434-343434343434',
   '35353535-3535-4535-8535-353535353535',
   'BTCUSDT','BTC',0.31,44000,61000
  );
 EXCEPTION WHEN check_violation THEN v_failed:=true;
 END;
 IF NOT v_failed THEN RAISE EXCEPTION 'Risk plan must not reserve quantity already reserved by another exit.'; END IF;
END $$;
-- Execute the SL threshold using the plan's reserved quantity, preserving
-- the unrelated 0.2 BTC reservation; replay must not create a second exit.
SELECT public.execute_paper_crypto_risk_exit(
 '31313131-3131-4131-8131-313131313131',
 '32323232-3232-4232-8232-323232323232',
 44000,80,1760,
 floor(extract(epoch from clock_timestamp())*1000)::bigint
);
SELECT public.execute_paper_crypto_risk_exit(
 '31313131-3131-4131-8131-313131313131',
 '32323232-3232-4232-8232-323232323232',
 44000,80,1760,
 floor(extract(epoch from clock_timestamp())*1000)::bigint
);
DO $assert_exit$
DECLARE v_reserved numeric; v_quantity numeric; v_status text; v_orders integer; v_ledger integer; v_reason text;
BEGIN
 SELECT reserved_quantity,quantity INTO v_reserved,v_quantity FROM public.paper_crypto_positions
 WHERE user_id='31313131-3131-4131-8131-313131313131' AND symbol='BTCUSDT';
 SELECT status,trigger_reason INTO v_status,v_reason FROM public.paper_crypto_risk_plans
 WHERE plan_id='32323232-3232-4232-8232-323232323232';
 SELECT count(*) INTO v_orders FROM public.paper_crypto_orders
 WHERE order_id='32323232-3232-4232-8232-323232323232' AND status='FILLED';
 SELECT count(*) INTO v_ledger FROM public.paper_crypto_ledger
 WHERE order_id='32323232-3232-4232-8232-323232323232';
 IF v_reserved<>0.2 OR v_quantity<>0.5 OR v_status<>'EXECUTED' OR v_reason<>'STOP_LOSS'
    OR v_orders<>1 OR v_ledger<>2 THEN
   RAISE EXCEPTION 'Risk exit accounting/idempotency failed: reserved %, qty %, status %, reason %, orders %, ledger %',
     v_reserved,v_quantity,v_status,v_reason,v_orders,v_ledger;
 END IF;
END $assert_exit$;
-- A second user can independently create and execute a full-position TAKE_PROFIT exit.
INSERT INTO public.paper_crypto_accounts(user_id,currency,starting_cash,cash_balance)
VALUES ('41414141-4141-4141-8141-414141414141','INR',1000000,1000000);
INSERT INTO public.paper_crypto_positions(user_id,symbol,base_asset,quantity,reserved_quantity,average_entry_price,cost_basis)
VALUES ('41414141-4141-4141-8141-414141414141','ETHUSDT','ETH',0.25,0,2000,40000);
SELECT public.create_paper_crypto_risk_plan(
 '41414141-4141-4141-8141-414141414141',
 '42424242-4242-4242-8242-424242424242',
 '43434343-4343-4343-8343-434343434343',
 'ETHUSDT','ETH',0.25,NULL,2500
);
DO $isolation$
BEGIN
  BEGIN
    PERFORM public.execute_paper_crypto_risk_exit(
      '31313131-3131-4131-8131-313131313131',
      '42424242-4242-4242-8242-424242424242',
      2500,80,50,floor(extract(epoch from clock_timestamp())*1000)::bigint
    );
    RAISE EXCEPTION 'A different user must not execute another user risk plan.';
  EXCEPTION WHEN no_data_found THEN
    NULL;
  END;
END $isolation$;
SELECT public.execute_paper_crypto_risk_exit(
 '41414141-4141-4141-8141-414141414141',
 '42424242-4242-4242-8242-424242424242',
 2500,80,50,floor(extract(epoch from clock_timestamp())*1000)::bigint
);
DO $full_exit$
DECLARE v_position_count integer; v_status text; v_reason text; v_cash numeric; v_order_count integer; v_ledger_count integer;
BEGIN
 SELECT count(*) INTO v_position_count FROM public.paper_crypto_positions
 WHERE user_id='41414141-4141-4141-8141-414141414141' AND symbol='ETHUSDT';
 SELECT status,trigger_reason INTO v_status,v_reason FROM public.paper_crypto_risk_plans
 WHERE plan_id='42424242-4242-4242-8242-424242424242';
 SELECT cash_balance INTO v_cash FROM public.paper_crypto_accounts
 WHERE user_id='41414141-4141-4141-8141-414141414141';
 SELECT count(*) INTO v_order_count FROM public.paper_crypto_orders
 WHERE order_id='42424242-4242-4242-8242-424242424242' AND status='FILLED';
 SELECT count(*) INTO v_ledger_count FROM public.paper_crypto_ledger
 WHERE order_id='42424242-4242-4242-8242-424242424242';
 IF v_position_count<>0 OR v_status<>'EXECUTED' OR v_reason<>'TAKE_PROFIT'
    OR v_cash<>1049950 OR v_order_count<>1 OR v_ledger_count<>2 THEN
   RAISE EXCEPTION 'Full-position target exit failed: positions %, status %, reason %, cash %, orders %, ledger %',
     v_position_count,v_status,v_reason,v_cash,v_order_count,v_ledger_count;
 END IF;
END $full_exit$;
RESET ROLE;
ROLLBACK;
