#!/usr/bin/env bash
set -euo pipefail

USER_ID="edededed-eded-4ded-8ded-edededededed"
ORDER_FILL="$(printf 'a1%.0s' {1..32})"
ORDER_CANCEL="$(printf 'b2%.0s' {1..32})"
ORDER_DUP="$(printf 'c3%.0s' {1..32})"
IDEM_FILL="edededed-0000-4000-8000-000000000001"
IDEM_CANCEL="edededed-0000-4000-8000-000000000002"
IDEM_DUP="edededed-0000-4000-8000-000000000003"
FINGERPRINT_FILL="$(printf 'a%.0s' {1..64})"
FINGERPRINT_CANCEL="$(printf 'b%.0s' {1..64})"
FINGERPRINT_DUP="$(printf 'c%.0s' {1..64})"
EXEC_FILL="OPTION-RACE-FILL-001"
EXEC_DUP="OPTION-RACE-DUP-001"

wait_for_terminal_update_lock() {
  local pattern="$1"
  for _ in {1..100}; do
    local active
    active="$(psql -Atqc "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%${pattern}%' AND wait_event_type='Timeout' AND wait_event='PgSleep';")"
    if [[ "$active" -ge 1 ]]; then return 0; fi
    sleep 0.05
  done
  echo "Timed out waiting for Options LIMIT row-lock race stage: ${pattern}" >&2
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
  true,0,1440,'SPECIAL','https://www.nseindia.com/market-data/holidays',
  clock_timestamp(),repeat('e',64)
)
ON CONFLICT(exchange,session_date) DO UPDATE SET
  is_trading_day=true,open_minute=0,close_minute=1440,
  session_kind='SPECIAL',source_reference='https://www.nseindia.com/market-data/holidays',
  verified_at=clock_timestamp(),source_sha256=repeat('e',64);

DELETE FROM public.paper_option_limit_fills
 WHERE order_id IN ('$ORDER_FILL','$ORDER_CANCEL','$ORDER_DUP');
DELETE FROM public.paper_option_limit_orders
 WHERE order_id IN ('$ORDER_FILL','$ORDER_CANCEL','$ORDER_DUP');
DELETE FROM public.paper_derivative_positions WHERE user_id='$USER_ID';
UPDATE public.paper_accounts SET cash_paise=starting_cash_paise,
  reserved_cash_paise=0,reserved_margin_paise=0,realized_pnl_paise=0
 WHERE user_id='$USER_ID';

SELECT public.submit_paper_option_limit_order(
 '$USER_ID','$ORDER_FILL','$IDEM_FILL','$FINGERPRINT_FILL',
 'NSE_FO|OPTION_RACE_FILL','OPTION_RACE_FILL','NSE','NSE_FO','CE',
 current_date+5,25000,65,5,'BUY',65,1250,
 floor(extract(epoch from clock_timestamp())*1000)::bigint,clock_timestamp()+interval '10 minutes'
);
SELECT public.submit_paper_option_limit_order(
 '$USER_ID','$ORDER_CANCEL','$IDEM_CANCEL','$FINGERPRINT_CANCEL',
 'NSE_FO|OPTION_RACE_CANCEL','OPTION_RACE_CANCEL','NSE','NSE_FO','PE',
 current_date+5,25000,65,5,'BUY',65,1250,
 floor(extract(epoch from clock_timestamp())*1000)::bigint,clock_timestamp()+interval '10 minutes'
);
SELECT public.submit_paper_option_limit_order(
 '$USER_ID','$ORDER_DUP','$IDEM_DUP','$FINGERPRINT_DUP',
 'NSE_FO|OPTION_RACE_DUP','OPTION_RACE_DUP','NSE','NSE_FO','CE',
 current_date+5,25000,65,5,'BUY',65,1250,
 floor(extract(epoch from clock_timestamp())*1000)::bigint,clock_timestamp()+interval '10 minutes'
);

CREATE OR REPLACE FUNCTION public.test_delay_options_limit_terminal_update()
RETURNS trigger LANGUAGE plpgsql AS \$\$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('FILLED','CANCELLED') THEN
    PERFORM pg_sleep(1);
  END IF;
  RETURN NEW;
END;
\$\$;
DROP TRIGGER IF EXISTS test_delay_options_limit_terminal_update ON public.paper_option_limit_orders;
CREATE TRIGGER test_delay_options_limit_terminal_update
BEFORE UPDATE ON public.paper_option_limit_orders
FOR EACH ROW EXECUTE FUNCTION public.test_delay_options_limit_terminal_update();
SQL

FILL_NOW="$(psql -Atqc "SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint")"
psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.execute_paper_option_limit_fill(
 '$ORDER_FILL','$EXEC_FILL',1,65,1240,1235,1240,100,65,$FILL_NOW,$FILL_NOW
);" >/tmp/zenura-options-fill-wins.log 2>&1 &
FILL_PID=$!
wait_for_terminal_update_lock "execute_paper_option_limit_fill"
psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.cancel_paper_option_limit_order('$USER_ID','$ORDER_FILL');" >/tmp/zenura-options-cancel-loses.log 2>&1
wait "$FILL_PID"

psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.cancel_paper_option_limit_order('$USER_ID','$ORDER_CANCEL');" >/tmp/zenura-options-cancel-wins.log 2>&1 &
CANCEL_PID=$!
wait_for_terminal_update_lock "cancel_paper_option_limit_order"
CANCEL_FILL_NOW="$(psql -Atqc "SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint")"
if psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.execute_paper_option_limit_fill(
 '$ORDER_CANCEL','OPTION-RACE-CANCEL-LOST',1,65,1240,1235,1240,100,65,$CANCEL_FILL_NOW,$CANCEL_FILL_NOW
);" >/tmp/zenura-options-fill-loses.log 2>&1; then
  echo "Options LIMIT fill unexpectedly succeeded after cancellation won."
  exit 1
fi
wait "$CANCEL_PID"

DUP_NOW="$(psql -Atqc "SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint")"
psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.execute_paper_option_limit_fill(
 '$ORDER_DUP','$EXEC_DUP',1,65,1240,1235,1240,100,65,$DUP_NOW,$DUP_NOW
);" >/tmp/zenura-options-duplicate-fill-1.log 2>&1 &
DUP1_PID=$!
wait_for_terminal_update_lock "execute_paper_option_limit_fill"
DUP_NOW2="$(psql -Atqc "SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint")"
psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.execute_paper_option_limit_fill(
 '$ORDER_DUP','$EXEC_DUP',1,65,1240,1235,1240,100,65,$DUP_NOW,$DUP_NOW2
);" >/tmp/zenura-options-duplicate-fill-2.log 2>&1 &
DUP2_PID=$!
wait "$DUP1_PID"
wait "$DUP2_PID"

psql -v ON_ERROR_STOP=1 <<SQL
DO \$race_assertions\$
DECLARE
  v_status_fill text;
  v_status_cancel text;
  v_status_dup text;
  v_reserved bigint;
  v_fill_count integer;
  v_filled integer;
BEGIN
  SELECT status INTO v_status_fill FROM public.paper_option_limit_orders WHERE order_id='$ORDER_FILL';
  SELECT status INTO v_status_cancel FROM public.paper_option_limit_orders WHERE order_id='$ORDER_CANCEL';
  SELECT status,filled_quantity INTO v_status_dup,v_filled
    FROM public.paper_option_limit_orders WHERE order_id='$ORDER_DUP';
  SELECT reserved_cash_paise INTO v_reserved FROM public.paper_accounts WHERE user_id='$USER_ID';
  SELECT count(*) INTO v_fill_count FROM public.paper_option_limit_fills
   WHERE order_id IN ('$ORDER_FILL','$ORDER_CANCEL','$ORDER_DUP');
  IF v_status_fill<>'FILLED' OR v_status_cancel<>'CANCELLED'
     OR v_status_dup<>'FILLED' OR v_filled<>65
     OR v_reserved<>0 OR v_fill_count<>2 THEN
    RAISE EXCEPTION 'Options LIMIT fill/cancel race mismatch: statuses %, %, %, duplicate filled %, reserved cash %, fills %',
      v_status_fill,v_status_cancel,v_status_dup,v_filled,v_reserved,v_fill_count;
  END IF;
  IF EXISTS(SELECT 1 FROM public.paper_derivative_positions
     WHERE user_id='$USER_ID' AND instrument_key='NSE_FO|OPTION_RACE_CANCEL') THEN
    RAISE EXCEPTION 'Cancelled Options LIMIT order created a position';
  END IF;
  IF (SELECT count(*) FROM public.paper_option_limit_fills WHERE order_id='$ORDER_DUP')<>1
     OR (SELECT filled_quantity FROM public.paper_option_limit_orders WHERE order_id='$ORDER_DUP')<>65 THEN
    RAISE EXCEPTION 'Concurrent duplicate Options execution was applied more than once';
  END IF;
END
\$race_assertions\$;

DROP TRIGGER IF EXISTS test_delay_options_limit_terminal_update ON public.paper_option_limit_orders;
DROP FUNCTION IF EXISTS public.test_delay_options_limit_terminal_update();
DELETE FROM public.paper_option_limit_fills
 WHERE order_id IN ('$ORDER_FILL','$ORDER_CANCEL','$ORDER_DUP');
DELETE FROM public.paper_option_limit_orders
 WHERE order_id IN ('$ORDER_FILL','$ORDER_CANCEL','$ORDER_DUP');
DELETE FROM public.paper_derivative_positions WHERE user_id='$USER_ID';
DELETE FROM public.paper_exchange_sessions
 WHERE source_reference='https://www.nseindia.com/market-data/holidays';
DELETE FROM public.paper_accounts WHERE user_id='$USER_ID';
DELETE FROM auth.users WHERE id='$USER_ID';
SQL
