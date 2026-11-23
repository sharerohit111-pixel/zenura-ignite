-- Regression checks for cross-user ownership, event shape and reversal uniqueness.
-- Runs after the equity append-only ledger and integrity-hardening migrations.
BEGIN;

INSERT INTO auth.users(id) VALUES
  ('88888888-8888-4888-8888-888888888888'),
  ('99999999-9999-4999-9999-999999999999')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.paper_orders(
  order_id,user_id,request_fingerprint,instrument_key,side,product,
  order_type,status,quantity,simulation_only
) VALUES
  (repeat('8',64),'88888888-8888-4888-8888-888888888888',repeat('a',64),
   'NSE_EQ|LEDGER_OWNER_A','BUY','DELIVERY','MARKET','FILLED',1,true),
  (repeat('9',64),'99999999-9999-4999-9999-999999999999',repeat('b',64),
   'NSE_EQ|LEDGER_OWNER_B','BUY','DELIVERY','MARKET','FILLED',1,true);

INSERT INTO public.paper_equity_fills(
  user_id,order_id,execution_id,instrument_key,exchange,product,side,
  quantity,execution_price_paise,gross_paise,charges_paise,
  charges_breakdown,cash_delta_paise,quote_timestamp_ms
) VALUES (
  '88888888-8888-4888-8888-888888888888',repeat('8',64),'owner-fill-1',
  'NSE_EQ|LEDGER_OWNER_A','NSE','DELIVERY','BUY',1,10000,10000,10,
  '{"indicative":true}'::jsonb,-10010,1
);

DO $equity_ledger_integrity_checks$
DECLARE
  v_fill uuid;
  v_original uuid;
BEGIN
  SELECT fill_id INTO v_fill FROM public.paper_equity_fills
   WHERE execution_id='owner-fill-1';

  -- A user cannot attach their identity to another user's order.
  BEGIN
    INSERT INTO public.paper_equity_fills(
      user_id,order_id,execution_id,instrument_key,exchange,product,side,
      quantity,execution_price_paise,gross_paise,charges_paise,
      charges_breakdown,cash_delta_paise,quote_timestamp_ms
    ) VALUES (
      '99999999-9999-4999-9999-999999999999',repeat('8',64),'wrong-owner-fill',
      'NSE_EQ|LEDGER_OWNER_A','NSE','DELIVERY','BUY',1,10000,10000,10,
      '{"indicative":true}'::jsonb,-10010,1
    );
    RAISE EXCEPTION 'Cross-user fill/order ownership was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- A cash event cannot point to a fill from a different order or user.
  BEGIN
    INSERT INTO public.paper_equity_cash_ledger(
      user_id,order_id,fill_id,event_key,event_type,cash_delta_paise,
      reserved_cash_delta_paise,cash_balance_after_paise,reserved_cash_after_paise
    ) VALUES (
      '99999999-9999-4999-9999-999999999999',repeat('9',64),v_fill,
      'wrong-owner-cash','TRADE_DEBIT',-10010,0,99989990,0
    );
    RAISE EXCEPTION 'Cross-order fill/ledger relationship was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- Reservation events must have the correct sign and be attached to an order.
  BEGIN
    INSERT INTO public.paper_equity_cash_ledger(
      user_id,order_id,event_key,event_type,cash_delta_paise,
      reserved_cash_delta_paise,cash_balance_after_paise,reserved_cash_after_paise
    ) VALUES (
      '88888888-8888-4888-8888-888888888888',repeat('8',64),
      'invalid-reservation','RESERVATION_CREATE',0,-100,99989990,100
    );
    RAISE EXCEPTION 'Invalid reservation event shape was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Insert the valid source trade debit.
  INSERT INTO public.paper_equity_cash_ledger(
    user_id,order_id,fill_id,event_key,event_type,cash_delta_paise,
    reserved_cash_delta_paise,cash_balance_after_paise,reserved_cash_after_paise
  ) VALUES (
    '88888888-8888-4888-8888-888888888888',repeat('8',64),v_fill,
    'source-trade-debit','TRADE_DEBIT',-10010,0,99989990,0
  ) RETURNING ledger_id INTO v_original;

  -- A reversal must belong to the same user as its source event.
  BEGIN
    INSERT INTO public.paper_equity_cash_ledger(
      user_id,event_key,event_type,cash_delta_paise,reserved_cash_delta_paise,
      cash_balance_after_paise,reserved_cash_after_paise,reversal_of_ledger_id,reason
    ) VALUES (
      '99999999-9999-4999-9999-999999999999','wrong-owner-reversal',
      'REVERSAL',10010,0,100000000,0,v_original,'Cross-user reversal must fail'
    );
    RAISE EXCEPTION 'Cross-user reversal was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  INSERT INTO public.paper_equity_cash_ledger(
    user_id,event_key,event_type,cash_delta_paise,reserved_cash_delta_paise,
    cash_balance_after_paise,reserved_cash_after_paise,reversal_of_ledger_id,reason
  ) VALUES (
    '88888888-8888-4888-8888-888888888888','source-trade-reversal',
    'REVERSAL',10010,0,100000000,0,v_original,'Test compensating reversal'
  );

  BEGIN
    INSERT INTO public.paper_equity_cash_ledger(
      user_id,event_key,event_type,cash_delta_paise,reserved_cash_delta_paise,
      cash_balance_after_paise,reserved_cash_after_paise,reversal_of_ledger_id,reason
    ) VALUES (
      '88888888-8888-4888-8888-888888888888','duplicate-source-reversal',
      'REVERSAL',10010,0,100010010,0,v_original,'Duplicate reversal must fail'
    );
    RAISE EXCEPTION 'Duplicate reversal of one source event was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END
$equity_ledger_integrity_checks$;

ROLLBACK;
