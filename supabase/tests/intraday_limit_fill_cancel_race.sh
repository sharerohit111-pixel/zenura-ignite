#!/usr/bin/env bash
set -euo pipefail

wait_for_terminal_update_lock() {
  local pattern="$1"
  for _ in {1..60}; do
    local active
    active="$(psql -Atqc "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%${pattern}%' AND wait_event_type='Timeout' AND wait_event='PgSleep';")"
    if [[ "$active" -ge 1 ]]; then return 0; fi
    sleep 0.05
  done
  echo "Timed out waiting for Intraday LIMIT row-lock race stage: ${pattern}" >&2
  exit 1
}

USER_ID="22222222-2222-4222-8222-222222222222"
BUY_ORDER="$(printf 'a%.0s' {1..64})"
SELL_ORDER="$(printf 'b%.0s' {1..64})"
SELL_EXEC_NOW=""
BUY_IDEMPOTENCY="44444444-4444-4444-8444-444444444444"
SELL_IDEMPOTENCY="55555555-5555-4555-8555-555555555555"

psql -v ON_ERROR_STOP=1 <<SQL
UPDATE public.paper_accounts
   SET starting_cash_paise=100000000,cash_paise=100000000,
       reserved_cash_paise=0,reserved_margin_paise=0,realized_pnl_paise=0,
       delivery_realized_pnl_paise=0,intraday_realized_pnl_paise=0,version=1
 WHERE user_id='$USER_ID';

INSERT INTO public.paper_exchange_sessions(
  exchange,session_date,is_trading_day,open_minute,close_minute,
  session_kind,source_reference,verified_at,source_sha256
) VALUES (
  'NSE',(clock_timestamp() at time zone 'Asia/Kolkata')::date,true,
  0,1440,'SPECIAL','CI Intraday LIMIT fill-cancel race fixture',clock_timestamp(),repeat('e',64)
)
ON CONFLICT(exchange,session_date) DO UPDATE SET
  is_trading_day=excluded.is_trading_day,open_minute=excluded.open_minute,
  close_minute=excluded.close_minute,session_kind=excluded.session_kind,
  source_reference=excluded.source_reference,verified_at=excluded.verified_at,
  source_sha256=excluded.source_sha256;

DELETE FROM public.paper_orders WHERE order_id IN ('$BUY_ORDER','$SELL_ORDER');
DELETE FROM public.paper_equity_positions
 WHERE user_id='$USER_ID' AND product='INTRADAY'
   AND instrument_key IN ('NSE_EQ|INTRADAY_RACE_BUY','NSE_EQ|INTRADAY_RACE_SELL');
INSERT INTO public.paper_equity_positions(
  user_id,product,instrument_key,trading_symbol,exchange,quantity,
  average_price_paise,cost_basis_paise,reserved_quantity
) VALUES (
  '$USER_ID','INTRADAY','NSE_EQ|INTRADAY_RACE_SELL',
  'INTRADAY_RACE_SELL','NSE',5,10000,50000,0
);

SELECT public.submit_paper_intraday_limit_order(
  '$USER_ID','$BUY_ORDER','$BUY_IDEMPOTENCY',repeat('c',64),
  'NSE_EQ|INTRADAY_RACE_BUY','INTRADAY_RACE_BUY','NSE','BUY',2,10000
);
SELECT public.submit_paper_intraday_limit_order(
  '$USER_ID','$SELL_ORDER','$SELL_IDEMPOTENCY',repeat('d',64),
  'NSE_EQ|INTRADAY_RACE_SELL','INTRADAY_RACE_SELL','NSE','SELL',2,11000
);

CREATE OR REPLACE FUNCTION public.test_delay_intraday_limit_terminal_update()
RETURNS trigger LANGUAGE plpgsql AS \$\$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('FILLED','CANCELLED') THEN
    PERFORM pg_sleep(1);
  END IF;
  RETURN NEW;
END;
\$\$;
DROP TRIGGER IF EXISTS test_delay_intraday_limit_terminal_update ON public.paper_orders;
CREATE TRIGGER test_delay_intraday_limit_terminal_update
BEFORE UPDATE ON public.paper_orders
FOR EACH ROW EXECUTE FUNCTION public.test_delay_intraday_limit_terminal_update();
SQL
BUY_EXEC_NOW="$(psql -Atqc "SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint")"

# BUY fill wins the account/order lock. A concurrent cancellation must not
# release the already-consumed reservation or overwrite FILLED with CANCELLED.
psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.execute_paper_intraday_limit_fill(
 '$BUY_ORDER',9900,$BUY_EXEC_NOW,0,$BUY_EXEC_NOW
);" >/tmp/zenura-intraday-buy-fill-wins.log 2>&1 &
BUY_FILL_PID=$!
wait_for_terminal_update_lock "execute_paper_intraday_limit_fill"
if psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.cancel_paper_intraday_limit_order('$USER_ID','$BUY_ORDER');" >/tmp/zenura-intraday-buy-cancel-loses.log 2>&1; then
  echo "Intraday LIMIT BUY cancellation unexpectedly succeeded after fill won."
  exit 1
fi
wait "$BUY_FILL_PID"

# SELL cancellation wins the account/order lock. A concurrent fill must not
# consume the shares or overwrite CANCELLED with FILLED.
psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.cancel_paper_intraday_limit_order('$USER_ID','$SELL_ORDER');" >/tmp/zenura-intraday-sell-cancel-wins.log 2>&1 &
SELL_CANCEL_PID=$!
wait_for_terminal_update_lock "cancel_paper_intraday_limit_order"
SELL_EXEC_NOW="$(psql -Atqc "SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint")"
if psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.execute_paper_intraday_limit_fill(
 '$SELL_ORDER',11000,$SELL_EXEC_NOW,0,$SELL_EXEC_NOW
);" >/tmp/zenura-intraday-sell-fill-loses.log 2>&1; then
  echo "Intraday LIMIT SELL fill unexpectedly succeeded after cancellation won."
  exit 1
fi
wait "$SELL_CANCEL_PID"

psql -v ON_ERROR_STOP=1 <<SQL
DO \$race_assertions\$
BEGIN
  IF (SELECT status FROM public.paper_orders WHERE order_id='$BUY_ORDER')<>'FILLED' THEN
    RAISE EXCEPTION 'BUY fill-first race did not finish FILLED';
  END IF;
  IF (SELECT status FROM public.paper_orders WHERE order_id='$SELL_ORDER')<>'CANCELLED' THEN
    RAISE EXCEPTION 'SELL cancel-first race did not finish CANCELLED';
  END IF;
  IF (SELECT reserved_cash_paise FROM public.paper_accounts WHERE user_id='$USER_ID')<>0 THEN
    RAISE EXCEPTION 'Intraday LIMIT race left cash reservations behind';
  END IF;
  IF (SELECT quantity FROM public.paper_equity_positions
      WHERE user_id='$USER_ID' AND product='INTRADAY'
        AND instrument_key='NSE_EQ|INTRADAY_RACE_BUY')<>2 THEN
    RAISE EXCEPTION 'BUY fill-first race did not create exactly one position';
  END IF;
  IF (SELECT quantity FROM public.paper_equity_positions
      WHERE user_id='$USER_ID' AND product='INTRADAY'
        AND instrument_key='NSE_EQ|INTRADAY_RACE_SELL')<>5
     OR (SELECT reserved_quantity FROM public.paper_equity_positions
      WHERE user_id='$USER_ID' AND product='INTRADAY'
        AND instrument_key='NSE_EQ|INTRADAY_RACE_SELL')<>0 THEN
    RAISE EXCEPTION 'SELL cancel-first race changed or reserved the position incorrectly';
  END IF;
  IF (SELECT cash_paise FROM public.paper_accounts WHERE user_id='$USER_ID')<>99980174 THEN
    RAISE EXCEPTION 'Intraday LIMIT BUY race debited virtual cash more than once';
  END IF;
END
\$race_assertions\$;

DROP TRIGGER IF EXISTS test_delay_intraday_limit_terminal_update ON public.paper_orders;
DROP FUNCTION IF EXISTS public.test_delay_intraday_limit_terminal_update();
DELETE FROM public.paper_orders WHERE order_id IN ('$BUY_ORDER','$SELL_ORDER');
DELETE FROM public.paper_equity_positions
 WHERE user_id='$USER_ID' AND product='INTRADAY'
   AND instrument_key IN ('NSE_EQ|INTRADAY_RACE_BUY','NSE_EQ|INTRADAY_RACE_SELL');
DELETE FROM public.paper_exchange_sessions
 WHERE source_reference='CI Intraday LIMIT fill-cancel race fixture';
UPDATE public.paper_accounts
   SET starting_cash_paise=100000000,cash_paise=100000000,
       reserved_cash_paise=0,reserved_margin_paise=0,realized_pnl_paise=0,
       delivery_realized_pnl_paise=0,intraday_realized_pnl_paise=0,
       version=version+1,updated_at=clock_timestamp()
 WHERE user_id='$USER_ID';
