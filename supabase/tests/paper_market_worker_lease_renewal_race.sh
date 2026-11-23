#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"

state_key="paper_futures_limit_orders"
old_owner="f3111111-1111-4111-8111-111111111111"
new_owner="f3222222-2222-4222-8222-222222222222"

seed_lease() {
  local token="$1"
  local expiry_ms="$2"
  psql -v ON_ERROR_STOP=1 -v token="$token" -v expiry_ms="$expiry_ms" <<'SQL'
INSERT INTO public.paper_market_worker_state(
  state_key,cursor_order_id,cursor_created_at,lease_token,lease_expires_at,updated_at
) VALUES (
  'paper_futures_limit_orders',NULL,NULL :'token'::uuid, to_timestamp((:expiry_ms)::double precision / 1000.0),clock_timestamp()
)
ON CONFLICT(state_key) DO UPDATE SET
  lease_token=EXCLUDED.lease_token,
  lease_expires_at=EXCLUDED.lease_expires_at,
  updated_at=clock_timestamp();
SQL
}

assert_false() {
  local label="$1"
  local sql="$2"
  local result
  result="$(psql -XAt -v ON_ERROR_STOP=1 -c "$sql")"
  if [[ "$result" != "f" ]]; then
    echo "$label: expected false, got '$result'" >&2
    exit 1
  fi
  echo "$label: passed"
}

# Race A: renewal wins the row lock first. A waiting reacquisition must see
# the extended expiry and must not steal the still-live owner token.
now_ms="$(date +%s%3N)"
seed_lease "$old_owner" "$((now_ms + 5000))"
(
  psql -v ON_ERROR_STOP=1 -c "BEGIN; SELECT public.renew_paper_market_worker_lease('$state_key','$old_owner',$now_ms,120000); SELECT pg_sleep(1); COMMIT;" >/dev/null
) &
renew_pid=$!
sleep 0.2
assert_false "Renewal-before-reacquisition race" "SELECT public.acquire_paper_market_worker_lease('$state_key','$new_owner',$((now_ms + 1000)),120000);"
wait "$renew_pid"

# Race B: expired-lease reacquisition wins the row lock first. A waiting
# stale renewal must observe the new owner token and must not resurrect it.
now_ms="$(date +%s%3N)"
seed_lease "$old_owner" "$((now_ms - 1000))"
(
  psql -v ON_ERROR_STOP=1 -c "BEGIN; SELECT public.acquire_paper_market_worker_lease('$state_key','$new_owner',$now_ms,120000); SELECT pg_sleep(1); COMMIT;" >/dev/null
) &
acquire_pid=$!
sleep 0.2
assert_false "Reacquisition-before-stale-renewal race" "SELECT public.renew_paper_market_worker_lease('$state_key','$old_owner',$((now_ms + 1000)),120000);"
wait "$acquire_pid"

psql -v ON_ERROR_STOP=1 -c "SELECT public.release_paper_market_worker_lease('$state_key','$new_owner',$(date +%s%3N));" >/dev/null
echo "Two-connection Futures worker lease races passed."
