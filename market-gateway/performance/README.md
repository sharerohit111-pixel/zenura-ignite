# Disposable / staging performance harness

This harness measures GET-only gateway latency, throughput, HTTP status distribution and transport failures across a bounded virtual-user ramp. It does not submit orders, cancel orders, mutate portfolios, run workers, or change schema.

## Safety boundary

- Default ramp: 10, 25, 50, 100, 250, 500 concurrent virtual users.
- Each stage runs for 10 seconds by default; maximum 60 seconds per stage.
- TARGET_ENV=disposable accepts only loopback, RFC1918 IPv4, .test or .local hosts.
- TARGET_ENV=staging requires HTTPS and an exact hostname in STAGING_HOST_ALLOWLIST.
- A deliberate acknowledgement is required through ZENURA_LOAD_TEST_CONFIRM=DISPOSABLE_OR_APPROVED_STAGING.
- Only a fixed allowlist of GET routes is accepted. No arbitrary URL, HTTP method or request body is configurable.
- Authenticated reads require a JSON token file. Keep it outside the repository, use disposable test users, and never print or commit it. Rate-limit consumption may write counters, so authenticated runs are restricted to disposable or explicitly approved staging only.
- Use synthetic instruments/test accounts only. Do not configure Upstox credentials or a real broker account.

## Run

From market-gateway/ with Node.js 22:

~~~bash
node --test test/performance-load-test.test.js
~~~

Run the harness against a local disposable gateway:

~~~bash
TARGET_ENV=disposable \
BASE_URL=http://127.0.0.1:8080 \
ZENURA_LOAD_TEST_CONFIRM=DISPOSABLE_OR_APPROVED_STAGING \
LOAD_PATHS=/health \
node performance/load-test.js
~~~

For authenticated read APIs, create a local JSON file containing JWTs for disposable test users and set AUTH_TOKEN_FILE=/secure/path/test-user-tokens.json. Select only routes from the fixed READ_ONLY_PATHS list. One token per virtual user is recommended to avoid measuring a single user's rate-limit budget rather than gateway capacity. SUPABASE_PUBLISHABLE_KEY may be set for authenticated Supabase requests.

For an approved staging target, set TARGET_ENV=staging, BASE_URL=https://approved-host, and STAGING_HOST_ALLOWLIST=approved-host. Obtain written environment-owner approval before running. Start with a low ramp and coordinate the 500-VU stage; it can create substantial read and rate-limit traffic.

## Configuration

| Variable | Default | Bounds / meaning |
|---|---:|---|
| LOAD_STAGES | 10,25,50,100,250,500 | Strictly ascending integers, 1–500 |
| STAGE_SECONDS | 10 | 1–60 seconds per stage |
| REQUEST_TIMEOUT_MS | 10000 | 250–30000 ms |
| LOAD_PATHS | /health | Comma-separated fixed GET route allowlist |
| AUTH_TOKEN_FILE | unset | JSON array of JWT strings; required for authenticated routes |
| STAGING_HOST_ALLOWLIST | unset | Exact comma-separated hostnames; staging only |

Output is newline-delimited JSON. Latency is time to response headers (TTFB), not full response-body download. p50/p95/p99 are computed from recorded request samples. HTTP 429 responses count as non-2xx errors; they are evidence of rate limiting, not transport failures.

## Interpretation

- Run against an isolated disposable PostgreSQL + gateway first.
- Capture host/container CPU and memory, PostgreSQL connection count, active sessions, lock waits, slow queries, pool saturation and recovery time separately; this script does not claim to measure those database internals.
- Compare each concurrency stage against the same environment and dataset. Do not infer production capacity from local laptop results.
- A passing harness/unit test does not equal a successful 500-user benchmark. Report actual run output, environment, commit SHA and resource telemetry before making capacity claims.
- This harness intentionally does not automate infrastructure provisioning or deploy anything.
