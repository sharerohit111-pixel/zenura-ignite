#!/usr/bin/env bash
set -euo pipefail

USER_ID="cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"; psql -v ON_ERROR_STOP=1 -c "DELETE FROM auth.users WHERE id='''$USER_ID''';" >/dev/null' EXIT

psql -v ON_ERROR_STOP=1 -c "INSERT INTO auth.users(id) VALUES ('$USER_ID') ON CONFLICT(id) DO NOTHING;"

export USER_ID
seq 1 40 | xargs -P40 -I{} bash -c '
  psql -XAtq -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.consume_paper_api_rate_limit('''$USER_ID''','''market_data''')->>'''allowed''';" > "'$TMP_DIR'/result-{}"
'

ALLOWED="$(grep -hxc true "$TMP_DIR"/result-* | awk '{sum+=$1} END {print sum+0}')"
BLOCKED="$(grep -hxc false "$TMP_DIR"/result-* | awk '{sum+=$1} END {print sum+0}')"
if [[ "$ALLOWED" -ne 30 || "$BLOCKED" -ne 10 ]]; then
  echo "Expected exactly 30 allowed and 10 blocked concurrent calls; got allowed=$ALLOWED blocked=$BLOCKED" >&2
  exit 1
fi
echo "Distributed rate-limit concurrency passed: $ALLOWED allowed, $BLOCKED blocked."
