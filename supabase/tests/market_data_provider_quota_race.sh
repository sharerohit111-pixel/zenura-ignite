#!/usr/bin/env bash
set -euo pipefail

psql -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM public.market_data_provider_quota_policies
 WHERE provider_id='quota-race' AND operation='quote';
INSERT INTO public.market_data_provider_quota_policies(
  provider_id,operation,provider_account_key,provider_capacity,provider_window_ms,
  user_capacity,user_window_ms,enabled
) VALUES ('quota-race','quote','quota-race-account',1,60000,100,60000,true);
SQL

cleanup() {
  psql -v ON_ERROR_STOP=1 -c "DELETE FROM public.market_data_provider_quota_policies WHERE provider_id='quota-race' AND operation='quote'" >/dev/null
}
trap cleanup EXIT

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"; cleanup' EXIT
export QUOTA_RESULT_DIR="$tmp_dir"

seq 1 12 | xargs -P 12 -I{} bash -c '
  result="$(psql -v ON_ERROR_STOP=1 -Atqc "select public.consume_market_data_provider_quota('''quota-race''','''quote''','''33333333-3333-4333-8333-333333333333''',1)->>'''allowed'''")"
  printf "%s\n" "$result" > "$QUOTA_RESULT_DIR/{}"
'

allowed="$(grep -hxc 'true' "$tmp_dir"/* | awk '{s+=$1} END {print s+0}')"
denied="$(grep -hxc 'false' "$tmp_dir"/* | awk '{s+=$1} END {print s+0}')"
if [[ "$allowed" -ne 1 || "$denied" -ne 11 ]]; then
  echo "Expected exactly one quota grant and eleven denials; got allowed=$allowed denied=$denied"
  exit 1
fi

echo "Distributed quota race passed: one request allowed, eleven denied."
