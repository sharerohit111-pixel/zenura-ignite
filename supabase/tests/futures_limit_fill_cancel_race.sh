#!/usr/bin/env bash
set -euo pipefail

USER_ID="efefefef-efef-4fef-8fef-efefefefefef"
ORDER_FILL="$(printf 'a1%.0s' {1..32})"
ORDER_CANCEL="$(printf 'b2%.0s' {1..32})"
ORDER_DUP="$(printf 'c3%.0s' {1..32})"
IDEM_FILL="efefefef-0000-4000-8000-000000000001"
IDEM_CANCEL="efefefef-0000-4000-8000-000000000002"
IDEM_DUP="efefefef-0000-4000-8000-000000000003"
EXEC_FILL="FUT-RACE-FILL-001"
EXEC_DUP="FUT-RACE-DUP-001"
FINGERPRINT_FILL="$(printf 'a%.0s' {1..64})"
FINGERPRINT_CANCEL="$(printf 'b%.0s' {1..64})"
FINGERPRINT_DUP="$(printf 'c%.0s' {1..64})"

wait_for_terminal_update_lock() {
  local pattern="$1"
  for _ in {1..100}; do
    local active
    active="$(psql -Atqc "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%${pattern}%' AND wait_event_type='Timeout' AND wait_event='PgSleep';")"
    if [[ "$active" -ge 1 ]]; then return 0; fi
    sleep 0.05
  done
  echo "Timed out waiting for Futures LIMIT row-lock race stage: ${pattern}" >&2
  exit 1
}

psql -v ON_ERROR_STOP=1 <<SQL
INSERT INTO auth.users(id) VALUES ('$USER_ID') ON CONFLICT(id) DO NOTHING;
SELECT public.initialize_paper_trading_account('$USER_ID');
INSERT INTO public.paper_exchange_sessions(
  exchange,session_date,is_trading_day,open_minute,close_minute,
  session_kind,source_reference,verified_at,source_sha256
) VALUES (
  'NSE',(clock_timestamp() at time zone 'Asia/Kolkata')::date,
  true,0,1440,'SPECIAL','https://www.nseindia.com/market-data/holidays',clock_timestamp(),repeat('e',64)
)
ON CONFLICT(exchange,session_date) DO UPDATE SET
  is_trading_day=true,open_minute=0,close_minute=1440,
  session_kind='SPECIAL',source_reference='https://www.nseindia.com/market-data/holidays',
  verified_at=clock_timestamp(),source_sha256=repeat('e',64);

DELETE FROM public.paper_futures_fills
 WHERE order_id IN ('$ORDER_FILL','$ORDER_CANCEL','$ORDER_DUP');
DELETE FROM public.paper_futures_orders
 WHERE order_id IN ('$ORDER_FILL','$ORDER_CANCEL','$ORDER_DUP');
DELETE FROM public.paper_futures_positions WHERE user_id='$USER_ID';
UPDATE public.paper_accounts SET cash_paise=starting_cash_paise,
  reserved_cash_paise=0,reserved_margin_paise=0,realized_pnl_paise=0
 WHERE user_id='$USER_ID';

SELECT public.submit_paper_futures_limit_order(
 '$USER_ID','$ORDER_FILL','$IDEM_FILL','$FINGERPRINT_FILL',
 'NSE_FO|FUT_RACE_FILL','FUT_RACE_FILL','NSE','NSE_FO',current_date+5,
 25,5,'BUY','DELIVERY',25,10000,100000,floor(extract(epoch from clock_timestamp())*1000)::bigint,floor(extract(epoch from clock_timestamp())*1000)::bigint,least(clock_timestamp()+interval '10 minutes', (((clock_timestamp() at time zone 'Asia/Kolkata')::date + 1)::timestamp at time zone 'Asia/Kolkata') - interval '1 second')
);
SELECT public.submit_paper_futures_limit_order(
 '$USER_ID','$ORDER_CANCEL','$IDEM_CANCEL','$FINGERPRINT_CANCEL',
 'NSE_FO|FUT_RACE_CANCEL','FUT_RACE_CANCEL','NSE','NSE_FO',current_date+5,
 25,5,'BUY','DELIVERY',25,10000,100000,floor(extract(epoch from clock_timestamp())*1000)::bigint,floor(extract(epoch from clock_timestamp())*1000)::bigint,least(clock_timestamp()+interval '10 minutes', (((clock_timestamp() at time zone 'Asia/Kolkata')::date + 1)::timestamp at time zone 'Asia/Kolkata') - interval '1 second')
);
SELECT public.submit_paper_futures_limit_order(
 '$USER_ID','$ORDER_DUP','$IDEM_DUP','$FINGERPRINT_DUP',
 'NSE_FO|FUT_RACE_DUP','FUT_RACE_DUP','NSE','NSE_FO',current_date+5,
 25,5,'BUY','DELIVERY',25,10000,100000,floor(extract(epoch from clock_timestamp())*1000)::bigint,floor(extract(epoch from clock_timestamp())*1000)::bigint,least(clock_timestamp()+interval '10 minutes', (((clock_timestamp() at time zone 'Asia/Kolkata')::date + 1)::timestamp at time zone 'Asia/Kolkata') - interval '1 second')
);

CREATE OR REPLACE FUNCTION public.test_delay_futures_limit_terminal_update()
RETURNS trigger LANGUAGE plpgsql AS \$\$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('FILLED','CANCELLED') THEN
    PERFORM pg_sleep(1);
  END IF;
  RETURN NEW;
END;
\$\$;
DROP TRIGGER IF EXISTS test_delay_futures_limit_terminal_update ON public.paper_futures_orders;
CREATE TRIGGER test_delay_futures_limit_terminal_update
BEFORE UPDATE ON public.paper_futures_orders
FOR EACH ROW EXECUTE FUNCTION public.test_delay_futures_limit_terminal_update();
SQL

# Fill wins the account/order locks; cancellation must observe FILLED and remain idempotent.
FILL_NOW="$(psql -Atqc "SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint")"
psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.execute_paper_futures_limit_fill(
 '$ORDER_FILL','$EXEC_FILL',1,25,9900,9895,9900,25,25,0,$FILL_NOW,$FILL_NOW
);" >/tmp/zenura-futures-fill-wins.log 2>&1 &
FILL_PID=$!
wait_for_terminal_update_lock "execute_paper_futures_limit_fill"
psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.cancel_paper_futures_limit_order('$USER_ID','$ORDER_FILL');" >/tmp/zenura-futures-cancel-loses.log 2>&1
wait "$FILL_PID"

# Cancellation wins the account/order locks; a later fill must reject the terminal order.
psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.cancel_paper_futures_limit_order('$USER_ID','$ORDER_CANCEL');" >/tmp/zenura-futures-cancel-wins.log 2>&1 &
CANCEL_PID=$!
wait_for_terminal_update_lock "cancel_paper_futures_limit_order"
CANCEL_FILL_NOW="$(psql -Atqc "SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint")"
if psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.execute_paper_futures_limit_fill(
 '$ORDER_CANCEL','FUT-RACE-CANCEL-LOST',1,25,9900,9895,9900,25,25,0,$CANCEL_FILL_NOW,$CANCEL_FILL_NOW
);" >/tmp/zenura-futures-fill-loses.log 2>&1; then
  echo "Futures LIMIT fill unexpectedly succeeded after cancellation won."
  exit 1
fi
wait "$CANCEL_PID"

# Two concurrent deliveries of the same provider execution must create one fill.
DUP_NOW="$(psql -Atqc "SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint")"
psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.execute_paper_futures_limit_fill(
 '$ORDER_DUP','$EXEC_DUP',1,25,9900,9895,9900,25,25,0,$DUP_NOW,$DUP_NOW
);" >/tmp/zenura-futures-duplicate-fill-1.log 2>&1 &
DUP1_PID=$!
wait_for_terminal_update_lock "execute_paper_futures_limit_fill"
DUP_NOW2="$(psql -Atqc "SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint")"
psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.execute_paper_futures_limit_fill(
 '$ORDER_DUP','$EXEC_DUP',1,25,9900,9895,9900,25,25,0,$DUP_NOW,$DUP_NOW2
);" >/tmp/zenura-futures-duplicate-fill-2.log 2>&1 &
DUP2_PID=$!
wait "$DUP1_PID"
wait "$DUP2_PID"

psql -v ON_ERROR_STOP=1 <<SQL
DO \$race_assertions\$
DECLARE
  v_margin bigint;
  v_fill_count integer;
  v_status_fill text;
  v_status_cancel text;
  v_status_dup text;
BEGIN
  SELECT status INTO v_status_fill FROM public.paper_futures_orders WHERE order_id='$ORDER_FILL';
  SELECT status INTO v_status_cancel FROM public.paper_futures_orders WHERE order_id='$ORDER_CANCEL';
  SELECT status INTO v_status_dup FROM public.paper_futures_orders WHERE order_id='$ORDER_DUP';
  SELECT reserved_margin_paise INTO v_margin FROM public.paper_accounts WHERE user_id='$USER_ID';
  SELECT count(*) INTO v_fill_count FROM public.paper_futures_fills
   WHERE order_id IN ('$ORDER_FILL','$ORDER_CANCEL','$ORDER_DUP');
  IF v_status_fill<>'FILLED' OR v_status_cancel<>'CANCELLED' OR v_status_dup<>'FILLED'
     OR v_margin<>200000 OR v_fill_count<>2 THEN
    RAISE EXCEPTION 'Futures LIMIT fill/cancel race mismatch: statuses %, %, %, margin %, fills %',
      v_status_fill,v_status_cancel,v_status_dup,v_margin,v_fill_count;
  END IF;
  IF EXISTS(SELECT 1 FROM public.paper_futures_positions
     WHERE user_id='$USER_ID' AND instrument_key='NSE_FO|FUT_RACE_CANCEL') THEN
    RAISE EXCEPTION 'Cancelled Futures LIMIT order created a position';
  END IF;
  IF (SELECT filled_quantity FROM public.paper_futures_orders WHERE order_id='$ORDER_DUP')<>25
     OR (SELECT count(*) FROM public.paper_futures_fills WHERE order_id='$ORDER_DUP')<>1 THEN
    RAISE EXCEPTION 'Concurrent duplicate Futures execution was applied more than once';
  END IF;
END
\$race_assertions\$;

DROP TRIGGER IF EXISTS test_delay_futures_limit_terminal_update ON public.paper_futures_orders;
DROP FUNCTION IF EXISTS public.test_delay_futures_limit_terminal_update();
DELETE FROM public.paper_futures_fills
 WHERE order_id IN ('$ORDER_FILL','$ORDER_CANCEL','$ORDER_DUP');
DELETE FROM public.paper_futures_orders
 WHERE order_id IN ('$ORDER_FILL','$ORDER_CANCEL','$ORDER_DUP');
DELETE FROM public.paper_futures_positions WHERE user_id='$USER_ID';
DELETE FROM public.paper_exchange_sessions
 WHERE source_reference='https://www.nseindia.com/market-data/holidays';
DELETE FROM public.paper_accounts WHERE user_id='$USER_ID';
DELETE FROM auth.users WHERE id='$USER_ID';
SQL
