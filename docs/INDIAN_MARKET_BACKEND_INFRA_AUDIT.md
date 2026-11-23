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
