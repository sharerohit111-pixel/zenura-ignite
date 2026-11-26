-- Regression: account reset cancels pending LIMIT orders, releases reserves,
-- closes positions, restores virtual starting cash, and preserves history.
-- Disposable PostgreSQL only.
BEGIN;

INSERT INTO auth.users(id)
VALUES ('21212121-2121-4212-8212-212121212121')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.paper_crypto_accounts(
 user_id,currency,starting_cash,cash_balance,reserved_cash,realized_pnl,version
) VALUES (
 '21212121-2121-4212-8212-212121212121','INR',1000000,900000,100,1234.5,7
);

INSERT INTO public.paper_crypto_positions(
 user_id,symbol,base_asset,quantity,reserved_quantity,average_entry_price,cost_basis,realized_pnl
) VALUES (
 '21212121-2121-4212-8212-212121212121','BTCUSDT','BTC',1,0.25,50000,50000,1234.5
);

-- One completed trade and its ledger entry must survive the reset.
INSERT INTO public.paper_crypto_orders(
 order_id,user_id,idempotency_key,request_fingerprint,symbol,base_asset,
 side,order_type,status,quantity,execution_price,fx_rate_inr,gross_value,fee
) VALUES (
 '22222222-2222-4222-8222-222222222221',
 '21212121-2121-4212-8212-212121212121',
 '23232323-2323-4323-8323-232323232321',repeat('c',64),
 'BTCUSDT','BTC','BUY','MARKET','FILLED',0.1,50000,80,400000,400
);

INSERT INTO public.paper_crypto_ledger(
 user_id,order_id,entry_type,currency,amount,balance_before,balance_after
) VALUES (
 '21212121-2121-4212-8212-212121212121',
 '22222222-2222-4222-8222-222222222221',
 'BUY','INR',-400000,1000000,600000
);

-- Pending LIMIT BUY reserves INR 100; pending LIMIT SELL reserves 0.25 BTC.
INSERT INTO public.paper_crypto_orders(
 order_id,user_id,idempotency_key,request_fingerprint,symbol,base_asset,
 side,order_type,status,quantity,limit_price,fee,reserved_amount
) VALUES
(
 '22222222-2222-4222-8222-222222222222',
 '21212121-2121-4212-8212-212121212121',
 '23232323-2323-4323-8323-232323232322',repeat('d',64),
 'ETHUSDT','ETH','BUY','LIMIT','PENDING',0.01,10000,0,100
),
(
 '22222222-2222-4222-8222-222222222223',
 '21212121-2121-4212-8212-212121212121',
 '23232323-2323-4323-8323-232323232323',repeat('e',64),
 'BTCUSDT','BTC','SELL','LIMIT','PENDING',0.25,60000,0,0
);

SET ROLE service_role;

SELECT public.reset_paper_crypto_account(
 '21212121-2121-4212-8212-212121212121',
 '24242424-2424-4424-8424-242424242424'
);

-- Replaying the same reset request must not create another reset event.
SELECT public.reset_paper_crypto_account(
 '21212121-2121-4212-8212-212121212121',
 '24242424-2424-4424-8424-242424242424'
);

DO $assert_reset$
DECLARE
 v_cash numeric(24,8); v_reserved_cash numeric(24,8); v_realized numeric(24,8);
 v_positions integer; v_pending integer; v_cancelled integer; v_filled integer;
 v_ledger integer; v_reset_events integer; v_reset_cash numeric(24,8);
BEGIN
 SELECT cash_balance,reserved_cash,realized_pnl
   INTO v_cash,v_reserved_cash,v_realized
   FROM public.paper_crypto_accounts
  WHERE user_id='21212121-2121-4212-8212-212121212121';

 SELECT count(*) INTO v_positions FROM public.paper_crypto_positions
  WHERE user_id='21212121-2121-4212-8212-212121212121';
 SELECT count(*) INTO v_pending FROM public.paper_crypto_orders
  WHERE user_id='21212121-2121-4212-8212-212121212121'
    AND order_type='LIMIT' AND status='PENDING';
 SELECT count(*) INTO v_cancelled FROM public.paper_crypto_orders
  WHERE user_id='21212121-2121-4212-8212-212121212121'
    AND order_type='LIMIT' AND status='CANCELLED';
 SELECT count(*) INTO v_filled FROM public.paper_crypto_orders
  WHERE user_id='21212121-2121-4212-8212-212121212121'
    AND order_type='MARKET' AND status='FILLED';
 SELECT count(*) INTO v_ledger FROM public.paper_crypto_ledger
  WHERE user_id='21212121-2121-4212-8212-212121212121';
 SELECT count(*),max(reset_cash) INTO v_reset_events,v_reset_cash
   FROM public.paper_crypto_account_resets
  WHERE user_id='21212121-2121-4212-8212-212121212121';

 IF v_cash<>1000000 OR v_reserved_cash<>0 OR v_realized<>0
    OR v_positions<>0 OR v_pending<>0 OR v_cancelled<>2
    OR v_filled<>1 OR v_ledger<>1 OR v_reset_events<>1 OR v_reset_cash<>1000000 THEN
   RAISE EXCEPTION 'Crypto account reset invariant failed: cash=%, reserved=%, realized=%, positions=%, pending=%, cancelled=%, filled=%, ledger=%, resets=%, reset_cash=%',
    v_cash,v_reserved_cash,v_realized,v_positions,v_pending,v_cancelled,v_filled,v_ledger,v_reset_events,v_reset_cash;
 END IF;
END
$assert_reset$;

RESET ROLE;
ROLLBACK;
