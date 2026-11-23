#!/usr/bin/env bash
set -euo pipefail

BUY_USER="c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0"
SELL_USER="d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0"
BUY_A="$(printf 'a%.0s' {1..64})"
BUY_B="$(printf 'b%.0s' {1..64})"
SELL_A="$(printf 'c%.0s' {1..64})"
SELL_B="$(printf 'd%.0s' {1..64})"

psql -v ON_ERROR_STOP=1 <<SQL
INSERT INTO auth.users(id) VALUES ('$BUY_USER'),('$SELL_USER') ON CONFLICT(id) DO NOTHING;
SELECT public.initialize_paper_trading_account('$BUY_USER');
SELECT public.initialize_paper_trading_account('$SELL_USER');
INSERT INTO public.paper_exchange_sessions(
 exchange,session_date,is_trading_day,open_minute,close_minute,
 session_kind,source_reference,verified_at,source_sha256
) VALUES (
 'NSE',(clock_timestamp() at time zone 'Asia/Kolkata')::date,
 true,0,1440,'SPECIAL','https://www.nseindia.com/market-data/holidays',
 clock_timestamp(),repeat('d',64)
)
ON CONFLICT(exchange,session_date) DO UPDATE SET
 is_trading_day=true,open_minute=0,close_minute=1440,session_kind='SPECIAL',
 source_reference='https://www.nseindia.com/market-data/holidays',
 verified_at=clock_timestamp(),source_sha256=repeat('d',64);

UPDATE public.paper_accounts SET cash_paise=100000,reserved_cash_paise=0,
 reserved_margin_paise=0,realized_pnl_paise=0
 WHERE user_id='$BUY_USER';

-- Seed the SELL race with one existing long CE lot.
SELECT public.execute_paper_long_option_order(
 '$SELL_USER',repeat('e',64),'d0d0d0d0-0000-4000-8000-000000000001',repeat('e',64),
 'NSE_FO|OPTION_RESERVE_RACE_SELL','OPTION_RESERVE_RACE_SELL',
 'NSE','NSE_FO','CE',(clock_timestamp() at time zone 'Asia/Kolkata')::date+5,
 25000,65,5,1,'BUY',1000,
 floor(extract(epoch from clock_timestamp())*1000)::bigint,
 floor(extract(epoch from clock_timestamp())*1000)::bigint
);

CREATE OR REPLACE FUNCTION public.test_delay_option_cash_reservation()
RETURNS trigger LANGUAGE plpgsql AS \$\$
BEGIN
 IF NEW.reserved_cash_paise>OLD.reserved_cash_paise THEN PERFORM pg_sleep(1); END IF;
 RETURN NEW;
END
\$\$;
CREATE TRIGGER test_delay_option_cash_reservation
BEFORE UPDATE ON public.paper_accounts
FOR EACH ROW EXECUTE FUNCTION public.test_delay_option_cash_reservation();

CREATE OR REPLACE FUNCTION public.test_delay_option_close_reservation()
RETURNS trigger LANGUAGE plpgsql AS \$\$
BEGIN
 IF NEW.reserved_quantity>OLD.reserved_quantity THEN PERFORM pg_sleep(1); END IF;
 RETURN NEW;
END
\$\$;
CREATE TRIGGER test_delay_option_close_reservation
BEFORE UPDATE ON public.paper_derivative_positions
FOR EACH ROW EXECUTE FUNCTION public.test_delay_option_close_reservation();
SQL

submit_buy() {
 local order="$1" key="$2" fingerprint="$3"
 psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.submit_paper_option_limit_order(
 '$BUY_USER','$order','$key','$fingerprint','NSE_FO|OPTION_RESERVE_RACE_BUY','OPTION_RESERVE_RACE_BUY',
 'NSE','NSE_FO','PE',(clock_timestamp() at time zone 'Asia/Kolkata')::date+5,
 25000,65,5,'BUY',65,1250,
 floor(extract(epoch from clock_timestamp())*1000)::bigint,
 clock_timestamp()+interval '10 minutes'
 );"
}
submit_sell() {
 local order="$1" key="$2" fingerprint="$3"
 psql -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.submit_paper_option_limit_order(
 '$SELL_USER','$order','$key','$fingerprint','NSE_FO|OPTION_RESERVE_RACE_SELL','OPTION_RESERVE_RACE_SELL',
 'NSE','NSE_FO','CE',(clock_timestamp() at time zone 'Asia/Kolkata')::date+5,
 25000,65,5,'SELL',65,1500,
 floor(extract(epoch from clock_timestamp())*1000)::bigint,
 clock_timestamp()+interval '10 minutes'
 );"
}

submit_buy "$BUY_A" "c0c0c0c0-0000-4000-8000-000000000001" "$(printf '1%.0s' {1..64})" >/tmp/options-buy-reserve-a.log 2>&1 &
P1=$!
submit_buy "$BUY_B" "c0c0c0c0-0000-4000-8000-000000000002" "$(printf '2%.0s' {1..64})" >/tmp/options-buy-reserve-b.log 2>&1 &
P2=$!
S1=0; S2=0
wait "$P1" || S1=1
wait "$P2" || S2=1
if [[ $((S1+S2)) -ne 1 ]]; then
 echo "Expected exactly one concurrent BUY cash reservation to succeed; statuses $S1/$S2" >&2
 exit 1
fi

submit_sell "$SELL_A" "d0d0d0d0-0000-4000-8000-000000000001" "$(printf '3%.0s' {1..64})" >/tmp/options-sell-reserve-a.log 2>&1 &
P3=$!
submit_sell "$SELL_B" "d0d0d0d0-0000-4000-8000-000000000002" "$(printf '4%.0s' {1..64})" >/tmp/options-sell-reserve-b.log 2>&1 &
P4=$!
S3=0; S4=0
wait "$P3" || S3=1
wait "$P4" || S4=1
if [[ $((S3+S4)) -ne 1 ]]; then
 echo "Expected exactly one concurrent SELL close reservation to succeed; statuses $S3/$S4" >&2
 exit 1
fi

psql -v ON_ERROR_STOP=1 <<SQL
DO \$reservation_race_assertions\$
DECLARE
 v_buy_reserved bigint;
 v_buy_pending integer;
 v_sell_reserved integer;
 v_sell_pending integer;
BEGIN
 SELECT reserved_cash_paise INTO v_buy_reserved FROM public.paper_accounts WHERE user_id='$BUY_USER';
 SELECT count(*) INTO v_buy_pending FROM public.paper_option_limit_orders
  WHERE user_id='$BUY_USER' AND status='PENDING' AND side='BUY';
 SELECT reserved_quantity INTO v_sell_reserved FROM public.paper_derivative_positions
  WHERE user_id='$SELL_USER' AND instrument_key='NSE_FO|OPTION_RESERVE_RACE_SELL';
 SELECT count(*) INTO v_sell_pending FROM public.paper_option_limit_orders
  WHERE user_id='$SELL_USER' AND status='PENDING' AND side='SELL';
 IF v_buy_reserved<>83646 OR v_buy_pending<>1 OR v_sell_reserved<>65 OR v_sell_pending<>1 THEN
  RAISE EXCEPTION 'Concurrent Options reservation conservation failed: BUY cash %, BUY pending %, SELL reserved %, SELL pending %',
   v_buy_reserved,v_buy_pending,v_sell_reserved,v_sell_pending;
 END IF;
END
\$reservation_race_assertions\$;

DROP TRIGGER IF EXISTS test_delay_option_cash_reservation ON public.paper_accounts;
DROP TRIGGER IF EXISTS test_delay_option_close_reservation ON public.paper_derivative_positions;
DROP FUNCTION IF EXISTS public.test_delay_option_cash_reservation();
DROP FUNCTION IF EXISTS public.test_delay_option_close_reservation();
DELETE FROM public.paper_option_limit_fills WHERE order_id IN ('$BUY_A','$BUY_B','$SELL_A','$SELL_B');
DELETE FROM public.paper_option_limit_orders WHERE order_id IN ('$BUY_A','$BUY_B','$SELL_A','$SELL_B');
DELETE FROM public.paper_derivative_positions WHERE user_id IN ('$BUY_USER','$SELL_USER');
DELETE FROM public.paper_exchange_sessions
 WHERE source_reference='https://www.nseindia.com/market-data/holidays';
DELETE FROM public.paper_accounts WHERE user_id IN ('$BUY_USER','$SELL_USER');
DELETE FROM auth.users WHERE id IN ('$BUY_USER','$SELL_USER');
SQL
