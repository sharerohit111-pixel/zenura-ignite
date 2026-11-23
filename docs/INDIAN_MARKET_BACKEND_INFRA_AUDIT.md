# Indian Market Backend API & Worker Infrastructure Audit

**Audit date:** 2026-11-23  
**Repository:** `sharerohit111-pixel/zenura-ignite`  
**Dedicated branch:** `feature/indian-market-backend-infra-supabase-2026-11-23`  
**Base:** Existing NSE Options LIMIT implementation branch `feature/indian-market-options-limit-schema`  
**Scope:** Indian Market gateway, authenticated APIs, market-data proxy, order APIs, worker lifecycle, retries, leases, idempotency, authorization, observability and failure recovery.  
**Excluded:** Crypto backend/runtime, production activation/deployment, and shared database migrations.

## 1. Repository and branch baseline

- Default branch is `main`.
- The Indian Market integration branch is `integration/supabase-native-auth-professional-launch-2026-11-22`.
- The backend gateway is implemented in `market-gateway/supabase-server.js`; the legacy Firebase gateway remains in `market-gateway/server.js`.
- The current Supabase-native backend line includes the existing Equity, Futures and NSE Options work from the open implementation PR chain, including PR #89 and PR #91.
- Related review work remains separate: PR #92 (equity append-only ledger schema foundation), PR #93 (Futures worker lease compatibility), and PR #94 (equity order-engine audit).
- This branch is based on the Supabase-native Options LIMIT implementation line so its backend inspection is against the current gateway, not the older `main` snapshot.

## 2. Existing API surface

### Gateway and market data

| API | Current behavior |
|---|---|
| `GET /health` | Public safe readiness data: instrument-master cache and worker status |
| `GET /instruments` | Public official Upstox BOD instrument-master search |
| `GET /candles` | Authenticated historical candle proxy |
| `GET /option-chain` | Authenticated option-chain proxy |
| `POST /stream` | Authenticated Upstox V3 WebSocket-to-SSE stream |
| `GET /upstox/connection` | Authenticated connection status |
| `POST /upstox/oauth/start`, `GET /upstox/oauth/callback`, `DELETE /upstox/connection` | OAuth lifecycle |

### Account, portfolio and equity

| API | Current behavior |
|---|---|
| `GET /paper/account` | Owner-scoped account snapshot |
| `POST /paper/orders` | Equity MARKET and LIMIT submission; DELIVERY and INTRADAY paths |
| `POST /paper/orders/:orderId/cancel` | Equity LIMIT cancellation |
| `GET /paper/orders` | Owner-scoped order history |
| `GET /paper/portfolio` | Owner-scoped cash-equity positions and quote-based valuation |
| `POST/GET /paper/protective-orders` and cancel route | Opt-in equity protective order APIs |

### Futures and Options

| API | Current behavior |
|---|---|
| `POST /paper/derivative/margin-preview` | Authenticated Futures margin preview with a database-backed per-user cooldown |
| `POST /paper/futures/orders` | Futures MARKET and LIMIT submission |
| `POST /paper/futures/orders/:orderId/cancel` | Futures LIMIT cancellation |
| `GET /paper/futures/orders`, `GET /paper/futures/portfolio` | Owner-scoped Futures history and valuation |
| `POST /paper/derivative/orders` | Options MARKET long BUY and SELL-to-close path |
| `POST /paper/derivative/limit-orders` | NSE Options LIMIT submit, guarded by two explicit feature flags and worker readiness |
| `GET /paper/derivative/limit-orders`, `DELETE /paper/derivative/limit-orders/:orderId` | Owner-scoped Options LIMIT history/fills and cancellation |
| `GET /paper/derivative/orders`, `GET /paper/derivatives/portfolio` | Owner-scoped derivative order history and portfolio |

Paper execution routes are simulation-only; the gateway does not submit broker/exchange orders.

## 3. Authentication and authorization

- Bearer tokens are parsed by `readBearerToken`.
- `createSupabaseRuntime.authenticateRequest` validates each token through Supabase Auth `getUser(token)` using the server-side service client and rejects missing/invalid UUID user identities.
- User-facing reads and writes use a Supabase client carrying the verified user's bearer token and rely on RLS.
- `callUserRpc` enforces a server RPC allowlist and injects the verified user ID rather than accepting a caller-supplied `p_user_id`.
- Worker-only and privileged operations use the service-role client from server-side code.
- The Options/Futures LIMIT PRs document service-role-only lease/fill RPCs and least-privilege table grants; do not broaden browser-role grants to bypass RLS.

**Review point:** continue checking every newly added route for explicit authentication, user scoping and RLS; avoid direct service-role reads for user-owned records unless an exact privileged boundary is documented.

## 4. Transaction boundaries and idempotency

- Order mutation boundaries are PostgreSQL RPC calls, rather than multi-step browser writes.
- Existing Equity MARKET/LIMIT paths use user-scoped RPC calls; PR #94 documents account-first locking and idempotency/fingerprint behavior in the audited equity paths.
- Futures and Options LIMIT implementations use dedicated submit/cancel/expiry/fill RPCs, reservations and per-fill records. PR #91 documents account → order → position lock order for Options.
- Idempotency keys are UUIDs; order IDs are deterministically derived from user ID plus key, and request fingerprints reject changed-payload key reuse.
- Worker execution uses stable execution identifiers and transactional fill RPCs in the derivative LIMIT paths.

**Shared DB boundary:** this audit does not modify SQL, migrations, RLS policies, RPC definitions or shared ledger contracts. Any such change must first be coordinated with the database/migrations owner (Chat 7).

## 5. Worker lifecycle, leases and retries

- Separate worker modules exist for Equity Delivery LIMIT, Equity Intraday LIMIT, Equity protective orders, Futures LIMIT and NSE Options LIMIT.
- Worker enablement is controlled by environment flags; Futures, Options, Intraday and protective workers are explicitly opt-in in the gateway code. Options LIMIT requires both submit and worker flags.
- Derivative LIMIT workers acquire a dedicated state-key lease with a random owner token and bounded TTL, scan a bounded order batch using a persisted cursor, group work by user, and release the lease in `finally`.
- Stream connections use per-process single-stream limits plus a database lease and lease heartbeat.
- Worker loops have a process-local single-flight/busy guard and bounded exponential backoff. Provider requests have a timeout wrapper; instrument refresh uses single-flight and a cooldown.
- A process crash should leave the lease to expire rather than requiring an unsafe forced release; this still needs explicit crash/reacquisition regression coverage for every lease key.
- Do not activate any worker in this branch or in a production environment without explicit approval.

**Deployment caution:** the existing deployment runbook/workflow describes enabling the Equity Delivery LIMIT worker during a manual production deployment. Do not run that workflow as part of this task. Actual deployed environment variables and live worker state have not been independently verified here.

## 6. Confirmed source-level issue fixed in this branch

The Equity LIMIT cancellation route queried `userDb.from("paper_orders")` but destructured only `user` from `auth(req)`. This left `userDb` undefined and could fail before reaching the cancellation RPC.

This branch now destructures `{user,userDb}` and adds a regression assertion to `market-gateway/test/supabase-deployment.test.js` that checks the route binds the authenticated user-scoped client and filters by the verified user ID.

## 7. Remaining infrastructure gaps / follow-up

1. **Gateway-wide rate limiting:** the inspected code has a database-backed 5-second per-user cooldown for margin preview and one active stream per account, but no common rate-limit middleware covering auth, market-data, watchlist, order, history and portfolio routes. Add a distributed, user/IP-aware policy only after choosing a shared implementation that does not require an uncoordinated migration.
2. **Pagination:** several order-history APIs cap results at 100; at least one returns `hasMore:false,nextCursor:null` regardless of whether more rows exist. Implement stable keyset cursors and explicit `hasMore` semantics.
3. **Request observability:** `/health` exposes safe worker/cache status, and workers emit console messages, but consistent request IDs, structured route logs, latency/error counters and correlation across RPC/provider calls are not yet standardized.
4. **Error taxonomy:** `sendError` maps status/timeouts to HTTP responses, but database RPC errors are often normalized to generic 409s. Define stable public error codes and preserve detailed internal diagnostics without leaking SQL/provider secrets.
5. **Cancellation symmetry:** verify Equity, Futures and Options cancellation ownership checks, idempotent replay semantics, terminal-state handling and fill-vs-cancel races using route and PostgreSQL tests.
6. **Lease recovery:** test wrong-owner release, expired-lease takeover, heartbeat loss, process crash, overlapping instances and cursor recovery for each worker key.
7. **Operational readiness:** staging authenticated browser-to-gateway rehearsal, provider data-rights approval, independent security review and controlled deployment/rollback remain release gates.

## 8. Safety and validation boundary

- Regression test selector was corrected after the first CI attempt; rerun must execute against the latest branch head (`f9287e14`) rather than the original PR commit.

- No shared database migration or schema change is included.
- No production deployment, worker activation, scheduler activation, secret change or live account operation is included.
- Crypto code and data paths are excluded.
- The Equity cancellation fix has a source-level regression test added; CI execution must be checked before treating the fix as runtime-verified.
- Keep this work in Draft until API contract, security, concurrency and staging checks pass.

## 9. Request correlation and structured error logging hardening

- The Supabase-native gateway now assigns a server-generated UUID request ID to each request and returns it in the `X-Request-Id` response header.
- The shared `sendError` path includes the request ID in the JSON error response for backward-compatible correlation.
- Failed requests emit one-line JSON logs with event name, request ID, HTTP status, method, route/path and error class.
- Raw error messages, request headers, bearer tokens, query values and provider payloads are deliberately excluded from these structured logs.
- Regression assertions cover request-ID generation/header propagation and the safe structured-log field set.
- This is request correlation, not a full metrics/tracing system; route latency histograms, RPC/provider spans and centralized log retention remain follow-up work.

## 10. Stable keyset pagination for order histories

- Added a bounded, validated opaque cursor helper using the composite `created_at` + `order_id` key.
- Equity, Futures, Options derivative history and Options LIMIT history now use descending composite ordering and a `limit + 1` query to compute truthful `hasMore` and `nextCursor` values.
- Cursor payloads are length-limited, base64url-only, timestamp-validated and order-ID-character-validated before being used in PostgREST filters.
- Existing `limit` parameter remains supported (1–100); clients can pass the returned `cursor` on the next request. Responses include `hasMore` and `nextCursor`.
- Options LIMIT fills are fetched only for the orders in the returned page.
- No database migration is required; this relies on existing `created_at` and `order_id` columns. Regression tests cover cursor round-trip, malformed input, composite boundary construction, page sizing and all four route integrations.
- This is keyset pagination, not a snapshot across multiple requests: newly inserted orders can appear ahead of the cursor, while the composite boundary prevents timestamp ties from duplicating or skipping rows.

## 11. Distributed rate-limiting architecture audit

**Finding:** the Supabase-native gateway has no shared route-wide rate-limit middleware. No Redis/Upstash package, endpoint, environment configuration or documented distributed limiter was found in the inspected gateway package/runtime configuration. Do not describe the process-local stream registry, worker busy flags, instrument-refresh cooldown or single-flight helpers as distributed rate limiting.

### Existing controls (narrow scope)

- POST /paper/derivative/margin-preview calls the database RPC consume_paper_margin_preview_slot after validating the instrument and before obtaining the user's Upstox token or calling the provider. The route currently returns 429 Retry-After: 5 when the RPC returns false **or when the RPC errors**. The latter is fail-closed but misclassifies limiter-backend unavailability as client throttling; a future common limiter should return 503 for backend failure, not 429.
- POST /stream has an in-process per-user reservation plus a database-backed account lease and heartbeat. This enforces one active stream per account across gateway instances when the lease RPC is healthy; it does not rate-limit connection attempts, reconnections or other API routes. The process-local map is only an optimization.
- OAuth callback state is consumed through a database RPC and is single-use, which protects replay but is not an IP/request-rate policy.
- Instrument refresh has process-local single-flight and a 30-second attempt cooldown; it is not a distributed client limiter.
- No common 429 response contract or route-level request budgets are currently enforced across orders, cancellations, history, portfolio, watchlists, candles, option-chain and OAuth routes.

### Deployment / identity findings

- The gateway package declares Express, Supabase JS, WebSocket and protobuf dependencies; no Redis/Upstash client is declared.
- Deployment documentation describes Cloud Run autoscaling from one to five instances and request concurrency of 40. Per-process counters therefore cannot provide a global quota.
- Express does not configure trust proxy in the inspected gateway. Do not use arbitrary X-Forwarded-For values as an IP identity. The correct client-IP source must be established from the actual Cloud Run ingress/load-balancer topology; if a trusted proxy chain is configured, trust only the known proxy boundary and test spoofed forwarding headers. Prefer an ingress/WAF policy for unauthenticated IP protection rather than relying solely on application parsing.
- The public surface includes /health, /instruments and /upstox/oauth/callback; authenticated routes call Supabase Auth before user-scoped work. IP-level controls must protect expensive unauthenticated paths before provider/database work. User-level quotas can only be keyed after verified Supabase identity is available.

### Recommended design (proposal only; not implemented)

1. **Ingress / IP layer:** apply Cloud Armor or an equivalent trusted edge policy for unauthenticated traffic, especially OAuth callback attempts and public instrument-master requests. Keep health checks separately allowlisted with conservative protection. Do not trust caller-supplied IP headers.
2. **Authenticated shared limiter:** prefer a single atomic shared backend. The existing Supabase/Postgres stack is a viable candidate for a dedicated atomic token-bucket/GCRA RPC, but it requires a new shared table/RPC/migration and therefore **must be reviewed with Chat 7 before any implementation**. Redis/Upstash is an alternative only after a service, credentials, network path, availability target and cost are explicitly selected; none is configured in the inspected branch.
3. **Keys and scopes:** combine verified user ID + route family for authenticated budgets; use a trusted, privacy-preserving IP key at ingress for unauthenticated budgets. Separate expensive provider-backed reads (candles, option-chain, quotes, margin preview, stream start), state-changing order submit/cancel, low-cost history/account reads, and OAuth lifecycle. Apply per-user and global/provider concurrency budgets where needed.
4. **Algorithm:** use an atomic token bucket or GCRA with explicit burst capacity and refill/window semantics. Avoid process-local counters and naive fixed windows that permit boundary bursts. The storage operation must be atomic across concurrent requests and all Cloud Run instances; keys need TTL/cleanup and bounded cardinality.
5. **Ordering:** apply body-size and ingress protections first; authenticate before user-keyed quotas; validate cheap shape/instrument constraints before consuming expensive-provider budgets; consume the appropriate quota before external provider calls or costly RPCs. Preserve order idempotency and ensure safe retries do not create duplicate effects.
6. **Failure policy:** fail closed for order mutations, OAuth token exchange, stream starts and expensive provider calls when the shared limiter is unavailable, returning 503 rate_limit_unavailable (not 429). Low-cost, non-sensitive reads may use a deliberately documented degraded policy only if an edge limit still protects the service. Never silently fall back to a per-process limiter.
7. **Response contract:** quota exhaustion returns 429, a stable code: "rate_limited", integer Retry-After, request ID and a safe message. CORS must expose Retry-After (already present for allowed origins). Do not return remaining quota or raw keys unless intentionally designed.
8. **Observability:** record route family, limiter decision, policy identifier, backend latency/failure, status and request ID. Never log raw IPs, bearer tokens, idempotency keys, OAuth codes/state, or limiter key material. Add dashboards/alerts for denied requests, backend errors, quota saturation and provider spend.

### Required tests before rollout

- Concurrent requests from multiple simulated gateway instances cannot exceed one shared budget.
- Burst/refill timing, exact boundary behavior, TTL expiry and clock-skew assumptions are deterministic.
- Verified users cannot consume another user's quota; spoofed user IDs and forwarding headers do not change identity.
- Unauthenticated OAuth callback and public instrument endpoints are protected at the trusted ingress.
- Limiter backend timeout/error maps to the documented fail-closed status; quota exhaustion maps to 429 + Retry-After.
- Order idempotent retries, submit/cancel races and existing margin/stream lease semantics remain intact.
- Load tests cover Cloud Run's documented instance concurrency and autoscaling; no production worker or gateway activation is part of this audit.

**Decision:** architecture audit and documentation only. No limiter middleware, process-local substitute, Redis/Upstash dependency, secret, SQL migration, RPC, RLS change or infrastructure activation is introduced in this change. Shared database work remains blocked on Chat 7 coordination.


## 12. Existing shared-schema coordination check

- Repository PR #70 (draft Supabase migration foundation) describes a proposed rate-limit-state table among its draft schema objects. Its own PR description says the migration set remains draft, has not been applied, and still requires SQL/RLS/runtime/concurrency validation.
- This is not evidence that a compatible shared limiter table/RPC exists in the current Indian Market migration chain or in the hosted database. Do not assume the PR #70 draft table is deployed, mergeable, or suitable for the new route-family/token-bucket policy.
- Before implementation, Chat 7 should reconcile PR #70's proposed rate-limit state with the current ordered migration chain and current hosted migration history, then decide whether to extend an existing draft object or create a forward-only migration. Avoid duplicate tables, conflicting key formats, or broadening service-role grants.
- No SQL file was copied, modified, applied, or merged as part of this coordination check.


## 13. Proposed route-family policy matrix (review required)

This matrix classifies work by cost and side-effect risk so Chat 7 / backend owners can agree a policy before implementation. It intentionally specifies **no numeric quotas, burst sizes or refill rates**; those require expected traffic, provider limits, product UX and shared-database capacity decisions.

| Route family | Representative routes | Identity / scope | Suggested enforcement point | Degraded-mode posture |
|---|---|---|---|---|
| Order mutations | Equity, Futures and Options submit; cancel; protective-order mutations | Verified Supabase user + mutation family; retain order-level idempotency | After authentication and cheap schema/instrument validation, before mutation RPC | Fail closed with 503 if shared limiter unavailable; quota exhaustion 429 |
| Expensive market/provider reads | Candles, option-chain, quote/provider-backed reads, margin preview | Verified user + provider/operation family; also global provider concurrency budget | After auth and cheap validation, before token/provider lookup or expensive provider call | Fail closed with 503; never translate backend outage to 429 |
| Stream lifecycle | Stream start/stop/reconnect | Verified user/account + stream lifecycle family; preserve DB account lease | Before acquiring/renewing stream lease; keep lease as a separate concurrency invariant | Fail closed for new stream starts if limiter/lease backend unavailable; cleanup existing streams safely |
| History and portfolio reads | Equity/Futures/Options order history, fills, portfolio, account | Verified user + read family | After auth; preserve user-scoped queries and cursor validation | A documented low-cost-read degraded policy may be considered only with ingress protection; no local-counter fallback |
| Public catalogue / health | Instruments, health | Trusted ingress identity for public catalogue; health isolated for platform probes | Edge/WAF before application/provider work; health has separate probe policy | Serve only from bounded cache where designed; protect origin from unauthenticated floods |
| OAuth lifecycle | OAuth start/callback/token exchange | Verified user for start; trusted ingress identity + validated one-time state for callback | Edge protection before callback parsing; user quota before start/token exchange | Fail closed for token exchange when shared policy backend is unavailable; preserve single-use state |
| Instrument refresh / admin jobs | Internal refresh and maintenance tasks | Service identity / job identity, not caller-supplied user identity | Scheduler/worker admission and global provider concurrency | Bounded retry with backoff; no overlapping refresh; never expose internal controls publicly |

### Cross-cutting invariants

- Route-family policy is additive to authentication, RLS, ownership checks, idempotency, order-state validation, worker leases and provider concurrency controls; it must not replace them.
- A user quota key must derive only from the authenticated Supabase subject. A request body, URL parameter or client header must never select another user's bucket.
- Public IP identity must come from a verified ingress boundary. Until Cloud Run's actual proxy chain is confirmed, application code must not treat arbitrary X-Forwarded-For as authoritative.
- Mutation retries must preserve the same idempotency key and request fingerprint. Rate limiting must not cause a second financial side effect or bypass a prior idempotent result.
- A 429 rate_limited response means a valid request exceeded a configured policy and includes integer Retry-After; a 503 rate_limit_unavailable response means the policy backend could not make a trustworthy decision. They are distinct operational conditions.
- Apply request/body limits and edge protection before parsing expensive payloads. Authenticate before user-keyed decisions. Perform cheap deterministic validation before consuming provider-heavy budgets.
- Quota values, global concurrency caps, route exceptions, retention/TTL, clock source and alert thresholds remain open design decisions. Record approvals and load-test evidence before rollout.
- Do not implement this matrix until Chat 7 confirms the shared schema/RPC contract and migration ordering. This section is a proposal, not an active policy.


## 14. Worker lease expiry, renewal and crash-recovery audit

### Observed implementation

- The Supabase worker lease RPC is an atomic `INSERT ... ON CONFLICT DO UPDATE` claim keyed by `state_key`. A claim can replace a lease only when the stored token/expiry is null or its expiry is at/before the caller-supplied `p_now_ms`. The RPC returns true only when the persisted token matches the caller token.
- The latest lease-key migration registers five isolated worker keys: Delivery LIMIT, Equity protective, Equity Intraday LIMIT, Futures LIMIT and Options LIMIT. The RPC accepts TTL values from 5,000 to 300,000 ms. The current worker modules inspected pass 240,000 ms.
- Release is owner-token guarded (`WHERE state_key = ... AND lease_token = p_lease_token`), so an old owner cannot release a newer owner's lease. Release does not require that the lease is still unexpired.
- The worker modules inspected acquire before scanning and release in `finally`. A process crash, forced termination, host loss or hard timeout skips `finally`; the lease remains until its persisted expiry and then becomes reclaimable. This is expected TTL-based crash recovery, but recovery latency can be up to the remaining lease duration.
- The shared `createLeaseHeartbeat` helper is tested in isolation, including overlap suppression, lost-lease callback and renewal-error callback. The inspected Equity Delivery LIMIT, Equity Intraday LIMIT, Futures LIMIT, Options LIMIT and protective worker modules do not import/use this helper or invoke a renewal RPC. No renewal RPC was found in the inspected lease migrations. Therefore there is no active lease extension during a long-running worker batch in these implementations.
- Cursor writes in the Intraday, Futures and Options LIMIT workers include both `state_key` and the current `lease_token`, which prevents an expired former owner from overwriting cursor state after a replacement claim. The inspected worker execution RPC calls do not pass the lease token as a fencing token; correctness during a stale worker's in-flight request must therefore rely on the order-level atomic status/reservation checks and execution-id/idempotency constraints inside each execution RPC.

### Existing test coverage and gaps

- Worker unit tests verify that a competing lease result (`data: false`) causes an early return without scanning or releasing another worker's lease. They also verify release is attempted after normal success and selected errors.
- `lease-heartbeat.test.js` tests the helper only; it does not prove any production worker uses it.
- `supabase/tests/intraday_limit_worker_lease.sql` verifies service-role-only grants, first acquisition, rejection of a concurrent second owner, rejection of non-owner release, owner release and reacquisition after explicit release.
- The inspected SQL test does not simulate a worker crash or prove takeover after the lease expiry timestamp. It also does not exercise simultaneous SQL claim transactions. No equivalent SQL lease test was found for Delivery LIMIT, protective, Futures LIMIT or Options LIMIT keys in the inspected test paths.
- The worker unit-test DB fakes generally return a preselected boolean for acquire/release. They do not model a real expiry clock, stale-owner takeover, release failure, process death between claim and cursor/fill, or a worker whose batch runs beyond 240 seconds.

### Risk assessment

1. **Long batch overlap:** without heartbeat renewal, a batch that exceeds its 240-second lease can overlap with a replacement worker. Per-order atomic RPCs should prevent duplicate accounting, but this needs explicit stale-worker fencing/race tests rather than assumption.
2. **Crash recovery delay:** a crashed worker is not immediately unlocked; another worker must wait for TTL expiry. The 240-second TTL is a recovery bound, not a recovery guarantee if the database clock/claim path is unhealthy.
3. **Clock authority:** acquire/takeover compares the caller-supplied millisecond timestamp to persisted expiry. Worker clocks should be synchronized, and the SQL contract should be reviewed for whether database time should be authoritative for lease expiry decisions.
4. **Cursor fencing is not execution fencing:** token-guarded cursor writes protect scan progress, but do not stop a stale process from attempting a fill RPC already in flight after lease takeover. Order-level compare-and-set/idempotency is the last line of defense.
5. **Heartbeat helper is currently orphaned from the inspected worker paths:** do not claim worker leases are renewed merely because the helper exists and has unit tests.

### Required follow-up before production confidence

- Add database-level expiry takeover tests with a controllable `p_now_ms`: active lease cannot be stolen; exact-expiry boundary can be reclaimed; expired owner cannot release replacement lease; invalid/overflow TTL inputs fail; independent state keys do not contend.
- Add concurrent SQL claim tests using two sessions/transactions to prove exactly one winner.
- Add stale-owner fencing tests: worker A claims, lease expires, worker B claims, then A attempts cursor update and execution RPC. A must not mutate cursor or create a duplicate fill; B must remain the sole valid lease owner.
- Exercise each registered key (Delivery, protective, Intraday, Futures, Options) against the same RPC contract and grants.
- Add deterministic worker tests for RPC failure after claim, provider timeout, cursor-save failure, release error, abrupt termination/restart, and batch duration beyond lease TTL.
- Decide explicitly whether workers should renew leases. If so, coordinate a forward-only shared RPC/migration with Chat 7, integrate heartbeat with cancellation on lease loss, and ensure every state mutation is fenced by the current token. Do not add heartbeat-only code that still permits stale execution RPCs.
- Keep TTL and batch-duration limits aligned with Cloud Run/job execution timeout and provider latency budgets. Do not change production schedules or worker activation as part of this audit.

**Decision:** audit/documentation only. No worker behavior, SQL, RPC, TTL, schedule, deployment or production activation was changed. A production-readiness claim for crash recovery remains blocked on the tests and fencing review above.

## 11. Route-by-route API contract and authorization review (2026-11-23)

Reviewed the current market-gateway/supabase-server.js, lib/supabase-runtime.js, history cursor helper and route regression tests on this branch.

### Authentication boundary

- All account, watchlist, quote-history, order, portfolio, derivative and SSE stream routes reviewed call the shared auth(req) helper before accessing user data or provider credentials.
- auth(req) extracts a single Bearer token, validates it through Supabase Auth getUser(token), then creates a user-scoped Supabase client with the verified access token.
- The OAuth callback and public instrument-master endpoint are intentionally unauthenticated protocol/public-data routes; they must remain narrowly scoped and must not expose account data.
- /health is a public readiness endpoint. Keep its output limited to non-secret operational status.
- The public /instruments route currently has bounded output (1–100) and bounded search text (60 chars), but no route-level or distributed rate limiter.
- The SSE /stream route uses the shared authenticated user path and a per-user active-stream guard.

### RPC and ownership boundary

- createSupabaseRuntime.callUserRpc rejects unallowlisted RPC names and rejects caller-supplied p_user_id; it injects the verified user UUID.
- User-owned reads use the user-scoped client and explicit user_id filters in the inspected order-history/account paths; RLS remains an independent required boundary.
- Worker/service-role operations are separate from user request RPC calls.
- Do not add service-role data reads to ordinary user routes as a shortcut.

### Confirmed gaps / required follow-up

1. **No gateway-wide distributed rate limiting:** the only explicit route-level throttle confirmed in this file is the 5-second database-backed margin-preview slot. This is not a global limiter. Public /instruments, authentication attempts, candles, option chain, portfolio and order routes need a designed shared policy. No Redis/Upstash dependency or implementation is present in market-gateway/package.json.
2. **Malformed JSON error contract — source fix committed:** CORS now runs before express.json; parser errors for malformed JSON and bodies over 32 KB receive safe JSON 400/413 responses with the already assigned request ID. The syntax-error log contains only request metadata and error class, not body or credentials. A regression assertion covers middleware order and response contracts; CI execution remains pending.
3. **Error taxonomy:** sendError returns a request ID and safe structured failure log, but it does not consistently map Supabase/Postgres error codes to stable public API codes. callUserRpc currently normalizes RPC failures to generic 409 while retaining an internal code on the thrown error. Define a route-independent internal taxonomy and safe public mapping without leaking database/provider details.
4. **Input schemas:** route handlers use a mix of explicit checks and ad-hoc coercion (String, Number, parseInt). Complete a route contract matrix for required fields, types, bounds, unknown fields, and stable 400/401/403/409/429/502/503 responses before introducing a shared validator.
5. **OAuth/public endpoints:** preserve the callback's state/redirect validation and test replay, missing/expired state, mismatched redirect and provider error paths. Keep public instrument search output restricted to official instrument-master fields.
6. **Pagination:** order-history routes reviewed use the existing composite descending keyset cursor and limit + 1 lookahead. Preserve this contract and add route-level tests for equal timestamps, malformed cursor, page boundary and user isolation; do not replace it with offset pagination.

### No-activation reminder

The repository deployment workflow contains a manual production deployment path that sets PAPER_LIMIT_WORKER_ENABLED=true. This review did not execute the workflow, deploy a service, change environment variables, or activate any worker/scheduler. Treat that workflow as a separate, explicitly gated release operation and do not run it during infrastructure audit work.

### API audit status

- Source-level review: complete for the route/authentication patterns and shared runtime helpers inspected.
- Full request/response schema matrix and end-to-end authenticated route execution: pending.
- Malformed JSON parser handling and source-level regression assertion: committed; CI execution pending.
- No SQL, migration, RLS, RPC or shared database changes were made.