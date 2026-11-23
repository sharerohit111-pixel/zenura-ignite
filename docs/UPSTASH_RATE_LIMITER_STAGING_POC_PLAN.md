# Upstash Rate Limiter — Staging POC Implementation Plan

**Date:** 2026-11-23  
**Branch:** `feature/indian-market-backend-infra-supabase-2026-11-23`  
**Parent decision:** `docs/UPSTASH_RATE_LIMITER_ARCHITECTURE_DECISION.md`  
**Status:** Plan only — implementation gated on explicit owner approval

## 1. Repository fit

The gateway package is Node.js 22 and uses the built-in Node test runner via `node --test test/*.test.js`. Keep the limiter isolated under `market-gateway/lib/` and its tests under `market-gateway/test/`. Do not put provider-specific Redis logic into route handlers or the Supabase runtime.

Proposed files, only after approval:
- `market-gateway/lib/rate-limit-policy.js` — immutable server-side policy registry and strict input validation.
- `market-gateway/lib/rate-limit-key.js` — namespaced, HMAC-derived opaque subject keys; no raw identifiers.
- `market-gateway/lib/upstash-rate-limiter.js` — isolated REST adapter with bounded timeout and strict response validation.
- `market-gateway/lib/rate-limit-errors.js` — typed backend-unavailable and invalid-policy errors.
- `market-gateway/test/rate-limit-policy.test.js`
- `market-gateway/test/rate-limit-key.test.js`
- `market-gateway/test/upstash-rate-limiter.test.js`
- `market-gateway/test/rate-limit-concurrency.integration.test.js` — opt-in staging integration test; skipped unless explicit test-only environment variables are present.

Do not modify `supabase-server.js` until the adapter and unit tests are complete and reviewed. Route integration is a separate later change.

## 2. Staged implementation sequence

### Stage A — Offline adapter and policy tests (no credentials, no network)
1. Add the provider-neutral `consume({ subject, policy, cost, requestId })` contract.
2. Validate policy against a fixed allowlist; reject unknown policy, blank subject, invalid cost, and overlong inputs.
3. Derive opaque keys with HMAC-SHA-256 using a dedicated secret distinct from Supabase and Upstash credentials. Include environment/service/policy namespace. Never log the key.
4. Implement REST request construction using Node 22 built-in `fetch`, `AbortSignal.timeout` or an injected abort signal, and bounded response parsing.
5. Validate HTTP status, JSON shape, allowed/remaining values, and retry-after values. Do not trust a malformed success response.
6. Unit-test with injected fake fetch and deterministic clock. No external network is used in this stage.

### Stage B — Atomic algorithm verification
1. Select exactly one algorithm (token bucket or GCRA) and document capacity, refill/window, time authority, TTL, and retry-after rounding.
2. Use a server-side atomic operation (Lua script / supported atomic SDK operation); never split read and write across client requests.
3. Verify that the selected REST endpoint supports the exact script invocation and response shape before implementation. Do not infer compatibility merely from generic scripting support.
4. Test burst allowance, refill, denied retry-after, TTL expiry, simultaneous requests, script errors and backend timeout.
5. Test key isolation across environments, policy families and subjects.

### Stage C — Staging-only shared-state proof
1. Requires an explicitly provisioned non-production Upstash database, region selection, spend cap and approved secret storage.
2. Use a dedicated test-only prefix and test identities; never point tests at production keys.
3. Run concurrent consumers from at least two independent Node processes (not just two promises in one process) and verify the aggregate accepted count never exceeds the shared bucket.
4. Record latency percentiles, command usage and failure behavior. Remove only the dedicated test namespace after evidence is retained; do not flush the database.
5. No gateway route is wired to the adapter during this stage.

### Stage D — Route integration (separate approval)
1. Add middleware/helper integration only after Stage A–C tests pass and numeric quotas are approved.
2. Authenticated user quotas are consumed only after `auth(req)` returns a verified user.
3. Public IP controls remain at a verified ingress/WAF layer until the trusted proxy/IP source is proven.
4. For protected routes, backend unavailable maps to 503; quota exhausted maps to 429 with integer Retry-After and request ID.
5. Preserve existing order idempotency, RPC boundaries, request correlation, CORS, margin-preview throttle, stream lease and keyset pagination.
6. Start with one low-risk route in staging; expand by policy family only after measured behavior and regression review.

## 3. Failure and security test matrix

| Scenario | Expected adapter result | Route-level expectation (later stage) |
|---|---|---|
| Valid allow | allowed | Continue existing handler |
| Quota exhausted | denied + positive retryAfterSeconds | 429 `rate_limited` |
| REST timeout / network failure | typed unavailable | 503 on protected routes |
| HTTP 401/403 from Upstash | typed configuration failure | 503; alert, no secret leak |
| HTTP 429 from Upstash service | backend unavailable/capacity signal, not user quota denial | 503 unless a verified quota decision is returned |
| HTTP 5xx | typed unavailable | 503 |
| Invalid JSON / missing fields / invalid numeric values | typed protocol failure | 503 |
| Unknown policy / invalid caller input | validation error | 500 for programmer misuse or safe 400 where genuinely client-derived; never pass arbitrary policy |
| Missing secret | adapter not ready | startup/readiness failure for staging; protected routes fail closed |
| Key derivation collision / namespace mix-up | test must prove isolation | No cross-user or cross-environment quota bleed |
| Duplicate order request | limiter may consume request budget; existing idempotency remains authoritative | Existing atomic RPC replay contract unchanged |

## 4. Explicit non-goals

- No Redis provisioning or vendor account creation.
- No package dependency until adapter choice and API compatibility are verified.
- No secrets, environment variables, Cloud Run configuration or IAM changes.
- No gateway route integration or behavior change.
- No Supabase SQL, schema, migration, RLS, RPC or database operation.
- No worker/scheduler activation, deployment, PR creation or merge.

## 5. Approval checklist before Stage A/B coding

- [ ] Product/security owner approves Upstash as the POC provider.
- [ ] Non-production database region and data handling are approved.
- [ ] Monthly spend cap and usage alerts are defined.
- [ ] Secret names and storage path are approved (values must never enter Git).
- [ ] Token bucket or GCRA semantics and initial test-only policy parameters are agreed.
- [ ] Staging-only test window and rollback/cleanup owner are identified.
- [ ] Chat 7 confirms no database changes are required for this POC (none are planned).

**Current state:** no implementation has started. This plan does not authorize provisioning or activation.
