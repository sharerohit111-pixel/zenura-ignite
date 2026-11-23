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
