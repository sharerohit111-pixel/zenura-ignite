# Upstox Integration & Security — Audit Baseline

Date: 2026-11-23
Scope: Indian Market only. No Crypto changes. No live broker orders.

## Branch and source baseline

- Work branch: `feature/indian-market-upstox-security`
- Branch starts from existing Indian Market Options LIMIT head `7a47bb29ff6ef2683a81f16cb01f70c37fdb473a` (PR #91 head), not the older `main` snapshot. This preserves the current Indian Market implementation.
- Related existing work: PR #83 (Indian Market gateway), PR #86 (fail-closed F&O quote policy), PR #91 (Options LIMIT and user token isolation), PR #93 (Futures LIMIT worker lease), PR #94 (Equity engine audit).
- No PR opened, no production migration, no deployment, no feature flag change, and no broker order placed.

## Existing implementation verified

### OAuth and token isolation
- `POST /upstox/oauth/start` authenticates the Supabase user, requires confirmed email, creates a 256-bit random state, stores only its SHA-256 hash, and uses a five-minute expiry.
- `GET /upstox/oauth/callback` consumes the state once, binds it to the saved Supabase user and connection generation, exchanges the single-use authorization code server-side, encrypts the access token, and saves it through a service-role-only RPC.
- Disconnect increments a per-user generation, deletes that user's connection, and revokes that user's stream lease.
- Token ciphertext uses AES-256-GCM with a random 12-byte IV and 16-byte authentication tag. Encryption key is expected in server-side `UPSTOX_TOKEN_ENCRYPTION_KEY`.
- User market-data requests resolve the connection using the authenticated Supabase user ID. No shared customer token is used.
- Standard Upstox access-token expiry is calculated as 03:30 Asia/Kolkata on the next applicable cutoff; expired tokens currently require reconnect.

### Market data
- Upstox V3 REST full quote and V3 protobuf WebSocket/SSE bridge exist.
- Instrument master is downloaded from Upstox's official BOD complete instrument file and cached with a six-hour refresh threshold.
- Existing feed validation rejects non-positive, stale, and excessively future-dated LTP ticks. Existing derivative quote policy additionally requires exact instrument identity, executable bid/ask depth and freshness; no LTP fallback for F&O LIMIT execution.
- Portfolio valuation has an explicit stale-quote withholding path.
- Stream leases, bounded subscriptions, backpressure, per-user stream registration and worker lease primitives exist.
- Existing exchange-session calendar tooling is present and missing/unverified sessions fail closed in the reviewed derivative worker path.

## Follow-up implementation and verification

- Extracted the service-role connection lookup into `market-gateway/lib/upstox-user-connection.js`; the gateway passes only the authenticated Supabase user ID and the query is explicitly constrained by `user_id`.
- Added `market-gateway/test/upstox-user-connection.test.js` covering two distinct user IDs returning only their own mocked connection rows, plus rejection of missing/invalid user identifiers before any database query.
- The two new isolation unit tests were executed in a temporary Node 22 harness using the exact committed helper and test source: 2 passed. This is a mocked query-builder unit test, not a live Supabase/RLS integration test; actual database isolation and service-role grants remain unverified until staging checks.
- The complete `market-gateway` test suite has not been executed because a repository checkout/runtime with its dependencies was not available in this session. GitHub Actions currently has no workflow run associated with the latest branch commit.

### OAuth replay, expiry and disconnect-generation regression coverage

- Added `supabase/tests/upstox_oauth_state_generation.sql` (transactional, rolls back) to verify one-time state consumption/replay rejection, expired-state rejection, stale callback save rejection after disconnect, successful save for a fresh generation, and final disconnect cleanup.
- Added `supabase/tests/upstox_oauth_generation_race.sh` to exercise both database lock orderings: save obtains the generation lock before disconnect, and disconnect obtains it before a stale save. It requires an explicitly configured disposable database URL plus `ALLOW_UPSTOX_DB_TESTS=1`; it must not be run against production.
- These SQL integration/race tests have been added but **not executed** in this session because no dedicated disposable PostgreSQL test database was made available. Do not interpret committed tests as passing evidence. Run the SQL file and race script against a resettable local/staging Supabase database before release.

## Findings and gaps requiring implementation or further proof

1. **No refresh-token flow is implemented.** The current standard OAuth access token is treated as a daily credential and expired connections require user reconnection. Upstox documents standard token expiry at 03:30 IST; the current code's behavior is consistent with this. Do not invent a refresh grant. Evaluate Upstox Analytics Token as a separate product/credential model only after confirming its account, static-IP and terms constraints; it must not become an undocumented shared end-user token.
2. **Token encryption key operations need a lifecycle plan.** AES-256-GCM envelope is sound as a primitive, but key rotation/versioning, KMS/Secret Manager access policy, backup/restore, emergency rotation, and zero-secret logging need explicit operational tests and runbook.
3. **OAuth callback input and response hardening.** Callback now validates raw query parameter types before use (repeated/array-valued `code` or `state` are rejected rather than coerced), and every callback redirect sets `Cache-Control: no-store`, `Pragma: no-cache`, and `Referrer-Policy: no-referrer`. The callback still logs only the caught error message; provider error payloads and upstream exception contents must remain redacted, and callback rate limits still need verification. Preserve one-time state and generation checks.
4. **Quote source/freshness contract is not uniform.** REST V3 full quote exposes exchange snapshot timestamp and depth; stream V3 provides feed-level currentTs plus trade LTT. Execution must use the correct source timestamp for the chosen price/depth, distinguish trade time from quote snapshot time, reject future/stale timestamps, exact-match instrument keys, positive displayed quantity, crossed books, invalid ticks and missing depth. LTP-only valuation is not an executable bid/ask.
5. **Exchange calendar and market status need one shared verified policy.** Keep exchange-specific holidays, special sessions, pre-open, closing auction, segment status and expiry cutoff explicit. Never infer a trading day from weekday. No order simulation fill outside a verified eligible session unless the specific simulation policy explicitly supports that session.
6. **Rate limits and recovery need endpoint-specific coverage.** Confirm per-user and global budgets, Upstox 429/Retry-After handling, bounded exponential backoff with jitter, circuit breaking, single-flight instrument refresh, WebSocket reconnect/resubscribe, lease renewal/loss behavior and no retry storms.
7. **RLS Advisor findings need grant-context verification.** Six internal tables have RLS enabled and zero policies: `paper_margin_preview_limits`, `paper_market_stream_leases`, `paper_market_worker_state`, `upstox_connection_controls`, `upstox_connections`, `upstox_oauth_states`. The initial SQL privilege probe returned false for direct SELECT/INSERT for anon, authenticated and service_role; the gateway currently performs direct service-role reads on `upstox_connections`, so verify schema usage, table ACLs, role membership and actual authenticated service-client behavior before changing grants. Do not add client policies or expose token ciphertext. If service-only access is intended, retain zero client grants and use narrowly scoped service-only RPCs or explicitly verified service-role ACLs.
8. **SECURITY DEFINER RPC review remains mandatory.** The inspected Upstox/stream RPCs have empty search_path and EXECUTE limited to service_role (plus owner/admin roles); inspect each function body, row ownership and input validation before any changes. No anon/authenticated execute grants were found for these functions.
9. **Secret leakage audit is incomplete.** Runtime configuration expects service role key, Upstox client secret and encryption key in server-only environment/Secret Manager. Complete a repository-wide secret scan and verify CI logs, health endpoints, error responses, source maps, browser bundles, Docker layers and deployment config. Never print or copy secret values.
10. **Market-data rights remain a release blocker.** Per-user OAuth/API entitlement is not proof of public redistribution/display rights. Obtain written Upstox approval and any exchange/vendor agreement for this exact app, user-by-user feed model, segments, depth, storage, display, caching, derived data, audience and commercial model. Qualified Indian securities counsel must classify the simulator under current SEBI rules before enabling public real-time display.

### Provider failure, stream recovery and log-surface audit (2026-11-23)

- Audited `market-gateway/supabase-server.js` and the provider/stream helpers. Upstox HTTP 401 handling is inconsistent: historical candles and option-chain map 401 to 403 without a stable reconnect-required error code; quote/margin/portfolio paths use different generic 502 responses. There is no coordinated per-user token invalidation/reconnect-required response contract.
- Upstox HTTP 429 is not handled consistently. The margin-preview endpoint has its own local 5-second application throttle and returns `Retry-After: 5`; this is not Upstox provider 429 handling. Provider 429 responses are otherwise collapsed into generic errors or worker failures; no shared bounded backoff/jitter or provider Retry-After policy was verified. Do not retry order-fill or other state-changing operations blindly.
- The `/stream` bridge currently terminates the client stream on upstream WebSocket error/close and releases its stream lease. It does not reconnect/resubscribe automatically. Client reconnect is therefore required; reconnect jitter, attempt limits and recovery after transient network/provider outages remain unimplemented/unverified.
- **Hardening applied:** non-binary upstream WebSocket frames are now ignored. The previous implementation reflected up to 300 characters of provider-controlled raw text to the browser as an `upstream` SSE event. This avoids exposing unreviewed provider text. Binary protobuf feed handling is unchanged.
- A source-level log review found no explicit access-token, Authorization-header, OAuth code, client-secret or encryption-key logging statements in `supabase-server.js`. Callback catch logging is limited to `error.message`; provider error payloads are not intentionally returned. However, this was a source review, not a full repository secret scan or runtime log capture. Worker logs include order/user identifiers and should remain access-controlled and retention-limited.
- These provider failure and WebSocket recovery behaviors have not been exercised against Upstox sandbox/live data or staging. No provider calls, production configuration changes or deployments were made in this audit step.

## Licensing and official references checked

- Upstox OAuth: https://upstox.com/developer/api-documentation/authentication/
- Upstox standard token: https://upstox.com/developer/api-documentation/get-token/
- Upstox Analytics Token overview: https://upstox.com/developer/api-documentation/
- Upstox Market Data Feed V3: https://upstox.com/developer/api-documentation/v3/get-market-data-feed/
- Upstox Full Market Quotes V3: https://upstox.com/developer/api-documentation/get-full-market-quote-v3/
- SEBI circular dated 8 May 2026, effective 1 July 2026: https://www.sebi.gov.in/legal/circulars/may-2026/norms-for-sharing-and-usage-of-price-data-for-educational-purposes_101293.html
- NSE Data Usage and Sharing Policy: https://nsearchives.nseindia.com/web/sites/default/files/inline-files/NSE_DataUsageandSharingPolicy.pdf
- NSE paid real-time data: https://www.nse.in/static/market-data/real-time-data-subscription

The SEBI circular specifies a 30-day lag for sharing and usage of price data for investor education/awareness, with a one-day NISM simulation-lab exception subject to an appropriate legal agreement. This is not a blanket authorization for a commercial paper-trading simulator. Product applicability requires legal review. NSE's data policy requires relevant agreements and restricts redistribution except as permitted by agreement.

## Safe implementation sequence

1. Complete source audit of OAuth, quote parsing, stream lifecycle, market calendar, worker recovery, rate limiting, environment/secrets and deployment.
2. Resolve direct service-role table access ambiguity and verify RLS/ACL/RPC boundaries with read-only checks and tests.
3. Add/adjust isolated tests and documentation first; then implement narrowly scoped changes on this branch only.
4. Test OAuth state replay, user A/B token isolation, disconnect generation races, encryption tamper/key rotation, expiry cutoff, 401/429/network failures, WebSocket reconnect, stale/future/crossed/missing depth, market-session boundaries and tenant isolation.
5. Verify data rights in writing and record approval evidence before any public real-time market-data deployment.
6. Keep all market-data and worker feature flags disabled until staging rehearsal and independent security/compliance review.

## Explicit safety boundary

Paper simulation only. No broker order-placement endpoint, no live trading, no production schema changes/deployment/merge, no Crypto files, and no market-data public launch without documented rights approval.

## Follow-up OAuth security test and live-database permission check (2026-11-23)

- Added `market-gateway/test/upstox-oauth-validation.test.js` covering valid and malformed OAuth callback inputs, strict 64-character hex state, authorization-code type/size/control-character checks, and token response validation.
- The AES-GCM crypto tests and IST expiry tests already exist in the branch; they were inspected and retained.
- GitHub Actions run lookup for the OAuth-test commit returned no workflow runs. Do not claim CI passed; execute `npm test` from `market-gateway` in the repository/CI before merge.
- The live Supabase migration history currently ends at `20261122123415`. It does **not** include later repository migration `20261123230000_market_gateway_service_role_read_grants.sql`.
- Live ACL inspection shows `service_role` currently has only `Dxtm` privileges on `upstox_connections` (no SELECT). The gateway's `getConnection(userId)` performs a direct service-client SELECT, so this connection-read path is expected to fail until the existing narrowly scoped read-grants migration is applied and verified. The same migration grants SELECT only to service_role and does not grant client-role access.
- Do not apply the migration from this audit task: production database changes remain outside this branch-only scope. Before deployment, apply the repository migration through the approved release process and re-check effective privileges and OAuth connection read in staging.
- The direct privilege probe's earlier false result was not an ACL ambiguity: table ACL inspection confirmed service_role has no SELECT on `upstox_connections`; the repository contains a later migration that remedies it, but the target project has not recorded that migration.

## Provider HTTP response policy hardening (2026-11-23)

- Added `market-gateway/lib/upstox-http-policy.js` with a bounded, provider-body-independent error contract:
  - HTTP 401 -> HTTP 401, code `upstox_reconnect_required`; user is told to reconnect. No automatic refresh is attempted.
  - HTTP 429 -> HTTP 429, code `upstox_rate_limited`; parses `Retry-After` as seconds or HTTP-date, clamps positive delays to 300 seconds, and exposes the sanitized delay via the response header.
  - Other unsuccessful Upstox market-data responses -> generic HTTP 502, code `upstream_provider_error`; provider response body is not exposed.
- Integrated the policy into full-quote, historical-candle, and option-chain requests. Existing error serializer now emits a stable machine-readable code and sanitized Retry-After header where present.
- No automatic retries were introduced. In particular, order submission/fill and worker RPC paths remain non-retried; worker-specific provider failure handling remains a follow-up audit item.
- Added focused unit tests for 401, 429, seconds/date Retry-After, clamping, invalid/past values, and generic upstream failures.
- Test execution in an isolated Node 22 harness: 5 passed, 0 failed. This validates the helper tests only; it is not a full gateway test run or a live Upstox/staging test.
- No provider calls, production configuration changes, migration, deployment, or real broker order occurred.

## WebSocket recovery hardening (2026-11-23)

- The `/stream` SSE bridge now makes a bounded reconnect attempt after upstream WebSocket error/close or subscription-send failure.
- Each retry obtains a fresh authorized feed URL from the Upstox feed-authorize endpoint; the existing validated URL guard is applied again.
- On each new socket, the original validated instrument-key set and feed mode are resubscribed. Existing event freshness/order filters remain in use.
- Reconnect backoff is exponential with jitter (1s base, 15s local backoff ceiling), at most five attempts. A provider `Retry-After` from an authorization 429 is respected, capped at 300 seconds. No provider payloads are sent to clients.
- HTTP 401 during reauthorization ends the stream with stable `upstox_reconnect_required`; lease loss/renewal failure still ends the stream immediately. The same per-user stream reservation and lease heartbeat remain active while reconnecting.
- Superseded sockets are closed and their late events ignored by socket-generation checks. Stream cleanup cancels a pending reconnect timer and releases the user reservation/lease.
- Added unit tests for retry delay, jitter, Retry-After cap, and attempt bounds. Isolated Node 22 harness verification: 3 passed, 0 failed; helper syntax check passed. These are helper-level tests; the WebSocket route has not yet been exercised against a mock Upstox server or staging.
- No production deployment, provider call, database migration, or real broker order occurred.


## REST quote and margin HTTP-policy coverage update (2026-11-23)

- Follow-up review found remaining authenticated REST call sites that still collapsed Upstox 401/429 into generic 502 responses: equity portfolio valuation, derivative portfolio valuation, watchlist quotes, futures portfolio valuation, derivative margin preview, futures market/limit margin estimation, and the delivery LIMIT worker's batch quote request.
- Updated those call sites in `market-gateway/supabase-server.js` to throw the existing sanitized `upstoxHttpError(response)` result. User-facing route handlers therefore use the same stable contract: 401 `upstox_reconnect_required`, 429 `upstox_rate_limited` with bounded `Retry-After`, and generic 502 `upstream_provider_error` for other provider failures.
- The worker's batch-quote path now classifies provider failures using the same helper; it still does not retry order-fill RPCs or provider requests automatically. Worker-level cooldown/backoff behavior for a user's repeated 401/429 remains a follow-up item and must be verified before enabling workers broadly.
- The change is limited to provider error classification; quote freshness, order/ledger logic, and retry policy are unchanged.
- Verification so far: all eight targeted source replacements matched exactly once and were committed. Full gateway tests, route-level mocked HTTP tests, CI, staging and live Upstox checks remain unverified. Do not treat the earlier helper-only tests as route-level proof.
- Latest change commit: `31942e0c3103b289ede75a97a9022deb2e7e06ae`. No production migration, deployment, provider call, Crypto change or real broker order occurred.


## Paper worker provider-error classification update (2026-11-23)

- Extended the same `upstoxHttpError` classification to the delivery LIMIT, intraday LIMIT, protective-order, futures LIMIT and options LIMIT worker quote requests.
- Worker batch warnings now include the stable provider error code alongside status, while omitting provider response bodies and credentials. This preserves the existing no-automatic-retry behavior for fill RPCs and order state changes.
- The workers still require a separate operational backoff/circuit-breaker policy for repeated per-user 401/429 failures. Current batch-level failure handling can revisit failed batches on later worker cycles; do not enable high-volume workers until bounded provider cooldown behavior is tested.
- Verification performed: source re-fetch confirmed the helper import, shared error conversion and sanitized status/code logging in all four extracted worker modules. Full module syntax/test execution, full gateway test suite, mock provider integration and CI remain unverified.
- Latest worker hardening commit: `6f9bed748c8b56f088feee9d6118067740b81895`.


## Per-user worker cooldown / provider circuit-breaker update (2026-11-23)

- Added shared `market-gateway/lib/upstox-user-cooldown.js`, used by the Delivery LIMIT worker and the Intraday LIMIT, Protective, Futures LIMIT and Options LIMIT workers.
- Cooldown is keyed by the authenticated Supabase user ID, shared by all worker modules in the same Node.js process, and bounded to 5,000 in-memory user entries. No token, provider body, or credential is stored in cooldown state.
- Provider failure policy:
  - 401 / `upstox_reconnect_required`: 5-minute reconnect cooldown. The connection is not deleted and no refresh grant is attempted.
  - 429: honors sanitized provider `Retry-After`, capped at five minutes; if absent, applies a bounded exponential cooldown starting at five seconds.
  - Network / 5xx / generic upstream provider failure: bounded exponential cooldown starting at five seconds and capped at one minute.
  - Other client errors do not open a provider cooldown.
- A successful provider quote response clears only that user's cooldown. Failures in downstream portfolio/ledger RPC processing after a successful provider response do not incorrectly count as provider failures.
- Workers skip provider calls for users whose cooldown is active. The Protective worker also updates `worker_checked_at` on skipped rows so a cooling-down user's orders do not starve other users in its ordered scan.
- Added eight focused cooldown policy tests for user isolation, 401, 429/Retry-After, exponential backoff, success reset, invalid input and bounded state. The isolated Node 22 harness run completed **8 passed, 0 failed**. A focused Intraday worker regression test was added to verify that a 429 suppresses the next worker-cycle provider call; that full worker test file has not been executed here.
- **Scope limitation:** this is an in-process cooldown, not a distributed circuit breaker. It does not coordinate separate gateway replicas/processes, and simultaneous first requests from different worker types can still race before a failure opens the cooldown. A shared database/Redis cooldown with atomic acquisition and a cross-replica half-open probe is required if the gateway runs multiple replicas or workers outside one process.
- Full gateway tests, all worker integration tests, CI, multi-replica concurrency tests, staging and live provider checks remain unverified. Do not enable production workers on the strength of the helper-only tests.
- No database schema or migration changes were made. No deployment, provider call, production setting change, Crypto change or real broker order occurred.
