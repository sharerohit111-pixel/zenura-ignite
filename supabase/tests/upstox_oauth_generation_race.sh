#!/usr/bin/env bash
set -euo pipefail

: "${UPSTOX_TEST_DATABASE_URL:?Set UPSTOX_TEST_DATABASE_URL to a disposable local/staging PostgreSQL database}"
if [[ "${ALLOW_UPSTOX_DB_TESTS:-}" != "1" ]]; then
  echo "Refusing database race test without ALLOW_UPSTOX_DB_TESTS=1" >&2
  exit 2
fi

USER_ID="a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1"
NOW="$(psql "$UPSTOX_TEST_DATABASE_URL" -Atqc "SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint")"
TOKEN_BOX='{"v":"1"}'

wait_for_sleep() {
  for _ in {1..100}; do
    local active
    active="$(psql "$UPSTOX_TEST_DATABASE_URL" -Atqc       "SELECT count(*) FROM pg_stat_activity WHERE query ILIKE '%pg_sleep(1)%' AND wait_event_type='Timeout' AND wait_event='PgSleep';")"
    if [[ "$active" -ge 1 ]]; then return 0; fi
    sleep 0.05
  done
  echo "Timed out waiting for OAuth transaction to hold its generation lock" >&2
  exit 1
}

cleanup() {
  psql "$UPSTOX_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c     "DELETE FROM auth.users WHERE id='$USER_ID';" >/dev/null || true
}
trap cleanup EXIT

psql "$UPSTOX_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO auth.users(id) VALUES ('$USER_ID') ON CONFLICT(id) DO NOTHING;
SELECT public.begin_upstox_oauth('$USER_ID',repeat('d',64),
  clock_timestamp()+interval '5 minutes',
  floor(extract(epoch from clock_timestamp())*1000)::bigint);
SQL

# Save acquires the generation row first. Disconnect waits, then removes the
# just-saved connection. Final state must be disconnected at generation 1.
psql "$UPSTOX_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL >/tmp/zenura-upstox-save-first.log 2>&1 &
BEGIN;
SELECT public.save_upstox_connection('$USER_ID',0,'$TOKEN_BOX'::jsonb,'Bearer',
  clock_timestamp()+interval '1 hour',clock_timestamp(),ARRAY[]::text[],
  floor(extract(epoch from clock_timestamp())*1000)::bigint);
SELECT pg_sleep(1);
COMMIT;
SQL
SAVE_PID=$!
wait_for_sleep
psql "$UPSTOX_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c   "SELECT public.disconnect_upstox_connection('$USER_ID',floor(extract(epoch from clock_timestamp())*1000)::bigint);" >/dev/null
wait "$SAVE_PID"

psql "$UPSTOX_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
DO \$assert_save_first\$
BEGIN
  IF (SELECT generation FROM public.upstox_connection_controls WHERE user_id='$USER_ID')<>1
     OR EXISTS(SELECT 1 FROM public.upstox_connections WHERE user_id='$USER_ID') THEN
    RAISE EXCEPTION 'Save-first/disconnect-second race left a stale connection';
  END IF;
END
\$assert_save_first\$;
SELECT public.begin_upstox_oauth('$USER_ID',repeat('e',64),
  clock_timestamp()+interval '5 minutes',
  floor(extract(epoch from clock_timestamp())*1000)::bigint);
SQL

# Disconnect acquires the generation row first. The callback's save waits,
# observes the new generation, and must return false without writing a row.
psql "$UPSTOX_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL >/tmp/zenura-upstox-disconnect-first.log 2>&1 &
BEGIN;
SELECT public.disconnect_upstox_connection('$USER_ID',
  floor(extract(epoch from clock_timestamp())*1000)::bigint);
SELECT pg_sleep(1);
COMMIT;
SQL
DISCONNECT_PID=$!
wait_for_sleep
psql "$UPSTOX_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c   "SELECT public.save_upstox_connection('$USER_ID',1,'$TOKEN_BOX'::jsonb,'Bearer',clock_timestamp()+interval '1 hour',clock_timestamp(),ARRAY[]::text[],floor(extract(epoch from clock_timestamp())*1000)::bigint);"   >/tmp/zenura-upstox-stale-save.log 2>&1
wait "$DISCONNECT_PID"

psql "$UPSTOX_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
DO \$assert_disconnect_first\$
BEGIN
  IF (SELECT generation FROM public.upstox_connection_controls WHERE user_id='$USER_ID')<>2
     OR EXISTS(SELECT 1 FROM public.upstox_connections WHERE user_id='$USER_ID') THEN
    RAISE EXCEPTION 'Disconnect-first/save-second race recreated a stale connection';
  END IF;
END
\$assert_disconnect_first\$;
SQL

echo "Upstox OAuth generation race tests passed (both lock orderings)."
