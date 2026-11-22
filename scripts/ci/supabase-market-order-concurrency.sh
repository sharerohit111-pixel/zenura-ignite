#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
: "${PGDATABASE:=paper_trading_security_test}"
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

USER_ID="33333333-3333-4333-8333-333333333333"
ORDER_ID="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
IDEMPOTENCY_KEY="33333333-3333-4333-8333-333333333333"
FINGERPRINT="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
INSTRUMENT="NSE_EQ|CONCURRENCY_TEST"

# Isolated third account for this test; no production credentials or endpoints.
psql -v ON_ERROR_STOP=1 <<SQL
INSERT INTO auth.users(id) VALUES ('$USER_ID');
SET ROLE service_role;
SELECT public.initialize_paper_trading_account('$USER_ID');
RESET ROLE;
SQL

run_order() {
  psql -X -v ON_ERROR_STOP=1 -Atc "SET ROLE service_role; SELECT public.execute_paper_market_order(
    '$USER_ID',
    '$ORDER_ID',
    '$IDEMPOTENCY_KEY'::uuid,
    '$FINGERPRINT',
    '$INSTRUMENT',
    'Concurrency Test',
    'NSE',
    'BUY',
    'DELIVERY',
    1,
    10000,
    1000000,
    0
  );"
}

# Start two independent PostgreSQL sessions with the same idempotency key.
run_order > /tmp/market-order-race-a.out &
PID_A=$!
run_order > /tmp/market-order-race-b.out &
PID_B=$!
wait "$PID_A"
wait "$PID_B"

# Account row locking + idempotency must produce one order and one cash debit.
psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
DECLARE
  v_count integer;
  v_cash bigint;
  v_initial bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.paper_orders
   WHERE user_id='$USER_ID' AND idempotency_key='$IDEMPOTENCY_KEY'::uuid;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Concurrency/idempotency failure: expected one order, got %', v_count;
  END IF;
  SELECT cash_paise, starting_cash_paise INTO v_cash, v_initial
   FROM public.paper_accounts WHERE user_id='$USER_ID';
  IF v_cash <> v_initial - 10000 THEN
    RAISE EXCEPTION 'Concurrency/idempotency failure: expected one 10000-paise debit, got initial %, current %', v_initial, v_cash;
  END IF;
END
\$\$;
SQL

# Reusing the same key for a different request fingerprint must be rejected.
if psql -X -v ON_ERROR_STOP=1 -Atc "SET ROLE service_role; SELECT public.execute_paper_market_order(
  '$USER_ID', '$ORDER_ID', '$IDEMPOTENCY_KEY'::uuid,
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  '$INSTRUMENT', 'Concurrency Test', 'NSE', 'BUY', 'DELIVERY', 1, 10000, 1000000, 0
);" >/tmp/market-order-reuse.out 2>&1; then
  echo "Expected idempotency-key fingerprint mismatch to fail" >&2
  exit 1
fi


# Race two distinct 60,000,000-paise BUYs against the same 100,000,000-paise account.
# The preceding idempotent BUY consumed 10,000 paise, so exactly one large BUY can win.
ORDER_A="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
ORDER_B="ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
KEY_A="44444444-4444-4444-8444-444444444444"
KEY_B="55555555-5555-4555-8555-555555555555"
FP_A="dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
FP_B="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
run_large_order() {
  psql -X -v ON_ERROR_STOP=1 -Atc "SET ROLE service_role; SELECT public.execute_paper_market_order(
    '$USER_ID', '$1', '$2'::uuid, '$3', 'NSE_EQ|CASH_RACE',
    'Cash Race', 'NSE', 'BUY', 'DELIVERY', 1, 60000000, 1000000, 0
  );"
}
set +e
run_large_order "$ORDER_A" "$KEY_A" "$FP_A" >/tmp/market-cash-race-a.out 2>&1 & PID_A=$!
run_large_order "$ORDER_B" "$KEY_B" "$FP_B" >/tmp/market-cash-race-b.out 2>&1 & PID_B=$!
wait "$PID_A"; STATUS_A=$?
wait "$PID_B"; STATUS_B=$?
set -e
if [ "$STATUS_A" -eq 0 ] && [ "$STATUS_B" -eq 0 ]; then
  echo "Cash race failure: both competing orders succeeded" >&2; exit 1
fi
if [ "$STATUS_A" -ne 0 ] && [ "$STATUS_B" -ne 0 ]; then
  echo "Cash race failure: both competing orders failed" >&2
  cat /tmp/market-cash-race-a.out /tmp/market-cash-race-b.out >&2
  exit 1
fi
psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
DECLARE v_count integer; v_cash bigint; v_initial bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.paper_orders
   WHERE user_id='$USER_ID' AND order_id IN ('$ORDER_A','$ORDER_B');
  IF v_count <> 1 THEN RAISE EXCEPTION 'Expected exactly one cash-race winner, got %',v_count; END IF;
  SELECT cash_paise,starting_cash_paise INTO v_cash,v_initial
   FROM public.paper_accounts WHERE user_id='$USER_ID';
  IF v_cash <> v_initial-10000-60000000 THEN
    RAISE EXCEPTION 'Expected exactly one large debit; initial %, current %',v_initial,v_cash;
  END IF;
END
\$\$;
SQL

echo "market order concurrent idempotency assertions passed"
