# Indian Market Distributed Rate Limiter — Architecture Decision

**Date:** 2026-11-23  
**Repository:** `sharerohit111-pixel/zenura-ignite`  
**Evaluation branch:** `feature/indian-market-backend-infra-supabase-2026-11-23`  
**Status:** Proposed — documentation only; not approved for production  
**Scope:** Supabase-native Indian Market gateway only

## 1. Decision summary

**Preferred candidate for a no-database-migration pilot: managed Upstash Redis, accessed over its HTTPS REST API, behind a small gateway-owned rate-limit adapter.** This is a candidate, not an authorization to provision a database, add credentials, add a package, or enable enforcement.

Why this candidate:
- A shared Redis state store can coordinate quota decisions across independently scaling Cloud Run instances; a process-local map cannot.
- Upstash exposes a REST API intended for serverless runtimes and documents Lua scripting support, allowing an atomic token-bucket/GCRA operation without opening a persistent Redis TCP connection.
- It does not require changes to Supabase schema, migrations, RLS or RPCs, preserving the Chat 7 approval boundary.
- The gateway already has a request-correlation ID and a common error response path that can carry a stable 429/503 contract.

**Do not select in-process memory as the enforcement mechanism.** It may be used only as a non-authoritative optimization, never as a fallback quota source.

**Alternative:** a Supabase/Postgres atomic limiter RPC is viable if the product wants one fewer external vendor, but it requires a new shared table/RPC/migration and explicit Chat 7 review. It is not authorized by this decision record.

## 2. Options comparison

| Option | Cross-instance correctness | DB coordination | Operational profile | Decision |
|---|---|---|---|---|
| In-process Map/counter | No; each instance has independent state and restarts reset it | None | Lowest setup, incorrect with autoscaling | Reject as enforcement |
| Supabase/Postgres atomic RPC | Yes, if implemented as one atomic transaction/locking contract | New schema/RPC/migration; Chat 7 approval required | Reuses existing platform, but adds write load and lock contention to the primary database | Valid alternative; blocked pending Chat 7 |
| Managed Upstash Redis REST | Yes, with atomic script/SDK operation against one shared database | No Supabase migration | Separate vendor, network dependency, credentials and usage billing; serverless-friendly REST interface | Preferred pilot candidate |
| Edge/WAF rate policy (e.g. Cloud Armor) | Yes for traffic passing through the configured load balancer | No app DB changes | Strong fit for unauthenticated/IP abuse; does not replace verified-user quotas or app route-family policy | Complement, not replacement |

The existing deployment notes describe Cloud Run autoscaling. Any in-memory limiter would fragment quotas across instances. The Cloud Run ingress topology must be verified before relying on forwarded IP headers or assuming all traffic passes through an external Application Load Balancer.

## 3. Upstash-specific findings

Official product documentation reviewed on 2026-11-23:
- Redis pricing currently lists a Free tier (250 MB, 500K monthly commands, 10 GB monthly bandwidth), Pay-as-you-go at **$0.20 per 100K commands**, and Fixed plans beginning at **$10/month**. Prod Pack is an additional **$200/month per database** for the listed production features, including uptime SLA and multi-zone HA. Pricing can change; re-check before provisioning.
- Upstash documents a REST API, and its REST compatibility page lists scripting support. Use an atomic server-side script or the maintained rate-limit SDK; do not implement a read-then-write sequence in application code.
- The Upstash rate-limit cost guide lists token-bucket normal state updates at four Redis commands, and two commands for a rate-limited miss; cached rate-limited hits may issue zero commands. At the published PAYG command price, four commands per check is roughly **$0.80 per 100K checks** before other usage, cache effects, bandwidth, storage, taxes and any plan changes. This is an indicative arithmetic estimate, not a traffic forecast or quote.
- The REST API avoids a long-lived TCP connection requirement, but each uncached check still adds a network dependency and latency. Reuse HTTP connections where supported by the runtime.

Sources:
- https://upstash.com/pricing/redis
- https://upstash.com/docs/redis/features/restapi
- https://upstash.com/docs/redis/sdks/ratelimit-ts/costs
- https://docs.cloud.google.com/run/docs/configuring/networking-best-practices
- https://docs.cloud.google.com/run/docs/securing/ingress

## 4. Proposed gateway contract

Introduce a provider-neutral interface in a separate module, with no direct Redis calls in route handlers:

```js
const decision = await rateLimiter.consume({
  subject: verifiedUserId,       // or trusted ingress IP key
  policy: "orders.submit",
  cost: 1,
  requestId
});
// { allowed: true, retryAfterSeconds: 0, policy: "orders.submit" }
// { allowed: false, retryAfterSeconds: 3, policy: "orders.submit" }
```

The adapter must:
- Accept only server-defined policy identifiers; clients cannot select limits or construct keys.
- Derive authenticated subjects only from the verified Supabase user UUID.
- Derive anonymous/IP subjects only from a verified ingress source; never trust arbitrary `X-Forwarded-For` input.
- Namespace keys by environment, service and policy, e.g. `s-trade:prod:gateway:orders.submit:<opaque-subject>`.
- HMAC/hash subject material before storage where feasible; do not store raw IP addresses, access tokens, OAuth state/codes, or idempotency keys in Redis keys or logs.
- Use atomic token bucket or GCRA with explicit capacity, refill/window, TTL and bounded key cardinality.
- Return a decision object; route handlers map it to HTTP. The limiter must not mutate order/account state.
- Have bounded timeout, bounded retry (prefer no retry on a request-path timeout), and no automatic local-memory fallback.
- Keep credentials server-only and load them from the deployment secret manager; never commit credentials or example real tokens.

## 5. Initial policy families (values intentionally not set)

Do not invent production quotas before traffic, provider terms and abuse cases are reviewed. Define server-side policy IDs and have the product/security owner approve numeric values separately.

| Policy family | Identity | Route examples | Enforcement intent |
|---|---|---|---|
| Public discovery | Trusted ingress IP + global service budget | `GET /instruments` | Protect public instrument search and upstream/cache resources |
| OAuth callback | Trusted ingress IP + global service budget | `GET /upstox/oauth/callback` | Bound callback abuse while preserving valid state/replay semantics |
| Provider market data | Verified user + route family; global provider budget | candles, option-chain, stream start | Protect provider quotas, spend and concurrency |
| Order mutations | Verified user + route family; global safety budget | equity/Futures/Options submit and cancel | Protect API and execution pipeline without weakening idempotency |
| Read APIs | Verified user + route family | account, portfolio, order history | Prevent scraping while allowing normal UI refresh |
| Health checks | Ingress/service-level policy | `GET /health` | Avoid starving health checks; keep response safe and inexpensive |

Do not rate-limit a route before authentication using a caller-supplied user ID. For authenticated quotas, authenticate first, then consume the user-keyed budget. Apply trusted ingress protection before the application for unauthenticated traffic.

## 6. HTTP and failure semantics

- Quota exhausted: HTTP **429**, stable code `rate_limited`, integer `Retry-After`, request ID, and a safe message.
- Shared limiter unavailable or timed out: HTTP **503**, stable code `rate_limit_unavailable` for protected mutations, OAuth token exchange, stream starts and expensive provider calls. Do not mislabel infrastructure failure as 429.
- No hidden fail-open or per-process fallback for protected routes.
- Low-cost read-route degradation, if desired, requires an explicit route-by-route approval and a separately enforced ingress safety policy.
- Preserve existing `X-Request-Id` behavior. Ensure CORS exposes `Retry-After` for allowed origins.
- Never return Redis keys, raw backend errors, remaining quota internals, or credentials.

## 7. Idempotency and route ordering

Rate limiting must not replace idempotency. For order submit:
1. Enforce body-size/parser and trusted ingress controls.
2. Authenticate and obtain the verified user-scoped client.
3. Validate cheap request shape and instrument/contract rules.
4. Consume the approved order-submit quota.
5. Invoke the existing atomic order RPC with the existing idempotency key/fingerprint contract.

A client retry after a timeout must continue to use the same idempotency key. Do not change order IDs, fingerprints, reservation semantics, or database transaction boundaries as part of limiter integration. Cancellation and submit races remain governed by the existing atomic database contracts.

## 8. Observability and privacy

Emit structured decision telemetry with request ID, route family, policy ID, allowed/denied/backend-error outcome, backend latency and HTTP status. Aggregate counts and latency histograms; do not log raw subjects, IPs, tokens, OAuth values, idempotency keys or Redis key material. Alert on backend availability, p95/p99 latency, denied-rate spikes, policy saturation and spend/budget thresholds.

## 9. Required validation before rollout

1. Two or more simulated gateway instances share one quota and cannot exceed it under concurrent load.
2. Token-bucket/GCRA burst, refill, exact boundary and TTL behavior are deterministic.
3. A verified user cannot consume another user's quota; spoofed user IDs and forwarded headers cannot change identity.
4. Limiter timeout, HTTP error, malformed response and budget exhaustion produce the documented fail-closed 503 on protected routes.
5. Exhaustion produces 429 with integer `Retry-After` and request ID.
6. Existing order idempotency, cancellation, margin-preview throttle, stream lease, and history keyset pagination regressions remain green.
7. Public OAuth/instrument endpoints are protected at a verified trusted ingress boundary.
8. Load tests cover the actual Cloud Run instance concurrency/autoscaling configuration.
9. Security review verifies secret storage, TLS, least-privilege database ACLs, data retention and provider/vendor terms.
10. Staging rehearsal confirms latency and cost at realistic request rates; no production worker activation is required.

## 10. Approval gates and non-goals

Before implementation, obtain explicit approval for:
- Selecting Upstash (or choosing the Postgres alternative), region and data-residency/privacy review.
- Provisioning a database and selecting plan/budget/availability requirements.
- Adding the SDK/dependency and secret names to deployment configuration.
- Numeric per-route/user/global quotas and the fail-closed route list.
- Any Cloud Armor/load-balancer configuration or trusted-proxy changes.

**Not done:** no Redis database provisioned; no package/dependency added; no secret or environment variable added; no middleware or route behavior changed; no SQL/schema/migration/RLS/RPC changed; no deployment, worker, scheduler or production activation performed; no PR opened or merged.

**Current recommendation:** approve a small staging-only Upstash REST/token-bucket proof of concept after the above owner decisions. Keep Postgres limiter work blocked on Chat 7, and keep in-process limiting out of the correctness path.
