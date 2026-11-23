-- Regression: authenticated Crypto reads must be scoped to auth.uid() for every user table.
-- Disposable PostgreSQL only.
BEGIN;

INSERT INTO auth.users(id) VALUES
 ('99999999-9999-4999-8999-999999999991'),
 ('99999999-9999-4999-8999-999999999992')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.paper_crypto_accounts(user_id,currency,starting_cash,cash_balance)
VALUES
 ('99999999-9999-4999-8999-999999999991','INR',1000000,1000000),
 ('99999999-9999-4999-8999-999999999992','INR',1000000,1000000);

INSERT INTO public.paper_crypto_positions(user_id,symbol,base_asset,quantity,average_entry_price,cost_basis)
VALUES
 ('99999999-9999-4999-8999-999999999991','BTCUSDT','BTC',0.001,8000000,8000),
 ('99999999-9999-4999-8999-999999999992','ETHUSDT','ETH',0.1,200000,20000);

INSERT INTO public.paper_crypto_orders(
 order_id,user_id,idempotency_key,request_fingerprint,symbol,base_asset,
 side,order_type,status,quantity,execution_price,simulation_only
) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','99999999-9999-4999-8999-999999999991',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',repeat('d',64),'BTCUSDT','BTC','BUY','MARKET','FILLED',0.001,100000,true),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','99999999-9999-4999-8999-999999999992',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',repeat('e',64),'ETHUSDT','ETH','BUY','MARKET','FILLED',0.1,2500,true);

INSERT INTO public.paper_crypto_ledger(user_id,order_id,entry_type,currency,amount,balance_before,balance_after)
VALUES
 ('99999999-9999-4999-8999-999999999991','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','BUY','INR',-8000,1000000,992000),
 ('99999999-9999-4999-8999-999999999992','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','BUY','INR',-20000,1000000,980000);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999991',true);

DO $crypto_rls_isolation$
DECLARE
 v_accounts integer;
 v_positions integer;
 v_orders integer;
 v_ledger integer;
BEGIN
 SELECT count(*) INTO v_accounts FROM public.paper_crypto_accounts;
 SELECT count(*) INTO v_positions FROM public.paper_crypto_positions;
 SELECT count(*) INTO v_orders FROM public.paper_crypto_orders;
 SELECT count(*) INTO v_ledger FROM public.paper_crypto_ledger;

 IF v_accounts<>1 OR v_positions<>1 OR v_orders<>1 OR v_ledger<>1 THEN
   RAISE EXCEPTION 'Crypto RLS leaked or hid user rows: accounts=%, positions=%, orders=%, ledger=%',
     v_accounts,v_positions,v_orders,v_ledger;
 END IF;

 IF EXISTS (SELECT 1 FROM public.paper_crypto_accounts
             WHERE user_id<>'99999999-9999-4999-8999-999999999991') THEN
   RAISE EXCEPTION 'Crypto account RLS exposed another user';
 END IF;
END
$crypto_rls_isolation$;

RESET ROLE;
ROLLBACK;
