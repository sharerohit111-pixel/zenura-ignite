# ZENURA IGNITE — Backend Portability & Migration Plan

**Status:** Architecture foundation / planning only  
**Current active backend:** Firebase Authentication + Firestore, Firebase Functions, and the Cloud Run Indian Market Gateway  
**Working branch:** `feature/backend-portability-foundation`  
**Baseline:** `integration/paper-trading-backend-main-2026-11-20`  
**Release rule:** No production deployment, provider switch, data deletion, or change to the live Firebase/Google Cloud project is authorized by this plan.

## 1. Goal

Keep the existing ZENURA IGNITE frontend, paper-trading rules, API behavior, user identity mapping, order history, portfolio, and virtual-balance invariants independent from any single cloud vendor.

The first implementation target remains Firebase/Google Cloud. Supabase and AWS are future provider adapters, not a reason to rewrite or pause the current app.

## 2. Existing architecture observed in this branch

- Browser application: `markets/stocks/` and the existing website shell.
- Identity: Firebase Authentication; the market gateway currently verifies Firebase ID tokens.
- Persistence: Firestore, including server-only collections such as `indianPaperAccounts`, `indianPaperOrders`, `indianDerivativeOrders`, `indianMarketWatchlists`, `upstoxConnections`, and stream/worker control records.
- Backend: Firebase Functions in `functions/indian-market.js`.
- Long-lived market gateway: `market-gateway/server.js`, currently initialized with Firebase Admin Auth and Firestore.
- Secrets: Firebase/Google Secret Manager configuration; Upstox credentials and encrypted token material must remain server-side.

**Important finding:** The market gateway and Functions currently call Firebase Admin / Firestore directly in several places. The code is not yet cloud-provider-neutral. Portability must be introduced behind tested interfaces in small steps; changing a few environment variables will not migrate this backend.

## 3. Target architecture

Keep the browser API contract stable and introduce provider boundaries inside the server:

```
Web / Android UI
      |
Stable HTTPS API contract
      |
Paper-trading application services (vendor-neutral)
      |
Ports / interfaces
  |           |            |
Identity    Trading      Secrets / config
Provider    Repository   Provider
  |           |
Firebase    Firestore       (current adapters)
Supabase    PostgreSQL      (future adapter)
AWS         RDS/Aurora       (future adapter)
```

The market-data provider integration (Upstox) remains a separate external-provider boundary. Cloud portability must not change quote validation, freshness rules, order idempotency, market-data permissions, or paper-only execution safeguards.

## 4. Required interfaces

Implement only after the current behavior is covered by tests:

1. **Identity verifier** — verifies bearer tokens and returns a stable internal principal: `{ uid, email, emailVerified }`. Preserve the existing Firebase UID as the canonical user ID during migration. New providers must map their subject IDs to this stable ID; never silently regenerate user IDs.
2. **Paper-trading repository** — methods for reading account/positions, placing and cancelling orders, reading order history, watchlists, derivative positions, stream leases, and rate-limit state.
3. **Atomic transaction boundary** — order placement, cash reservation/release, position updates, idempotency record, and ledger/order writes must commit atomically. A provider adapter must prove equivalent isolation/consistency before it can be enabled.
4. **Secret/config provider** — retrieves Upstox client secrets, token-encryption key, and runtime configuration from the active cloud secret store. Secret values must never be committed or returned to the browser.
5. **Clock / server timestamp abstraction** — preserves expiry, audit, and ordering semantics across providers.

Do not expose Firestore document references, snapshots, FieldValue sentinels, or Firestore transaction objects to application/domain modules.

## 5. Non-negotiable financial-data invariants

- All money remains integer paise in storage and calculations; never use floating-point rupees for authoritative balances.
- A user's virtual cash, reserved cash, positions, realized P&L, and order history must reconcile before and after migration.
- Idempotency keys and request fingerprints remain stable; retries must never create duplicate fills.
- Order execution must use server-validated, fresh, exact-instrument provider quotes. Browser-supplied prices are never authoritative.
- Pending LIMIT orders remain disabled for scheduled matching until a separately approved staging end-to-end rollout. This plan does not enable the worker.
- This is a paper-trading simulator only; no real broker/exchange order submission is introduced.
- Keep Indian-market data isolated from Crypto and other product workspaces.

## 6. Provider mapping (future adapters)

| Capability | Current Firebase / Google Cloud | Supabase option | AWS option |
|---|---|---|---|
| Authentication | Firebase Auth | Supabase Auth | Cognito |
| Transactional database | Firestore transactions | PostgreSQL transactions / RPC | RDS or Aurora PostgreSQL transactions |
| HTTP API / compute | Cloud Run + Functions | Supabase Edge Functions or separate service | ECS/Fargate or Lambda |
| Secrets | Secret Manager | Supabase secrets / external vault | Secrets Manager |
| Object storage | Cloud Storage | Supabase Storage | S3 |
| Monitoring | Cloud Logging / Monitoring | Provider logs + chosen monitoring | CloudWatch |

This is a capability map, not a claim that the services are interchangeable without implementation and testing. In particular, Firestore document/collection semantics must be deliberately mapped to relational tables and constraints for PostgreSQL.

## 7. Migration runbook — only after explicit approval

1. Freeze and identify the exact source commit; create a verified backup of source code and provider data.
2. Export required Firestore collections and Firebase Auth users using supported administrative export methods. Do not assume a GitHub checkout contains live production data.
3. Build a documented mapping for every collection, nested document, timestamp, reference, and numeric field.
4. Preserve canonical user IDs and order IDs. Build deterministic, repeatable import tooling with dry-run mode and per-record error reports.
5. Import into an isolated staging database; do not dual-write production data as an experiment.
6. Reconcile record counts and financial totals: account cash, reserved cash, positions, order counts, order states, and realized/unrealized P&L.
7. Run contract tests, concurrency tests, idempotency/retry tests, authorization tests, and staging end-to-end tests.
8. Verify authentication migration and account recovery. Passwords may not be portable as-is; use a secure re-authentication / account-linking flow if hashes cannot be imported safely.
9. Keep Firebase live and unchanged during testing. Switch traffic only after explicit approval and a rehearsed rollback plan.
10. Retain a read-only source snapshot for the agreed recovery period. Do not delete Firebase/Google Cloud resources until post-cutover reconciliation and sign-off are complete.

## 8. Implementation sequence

- **Phase 0 — Baseline (this change):** record current architecture, constraints, invariants, and migration gates.
- **Phase 1 — Contract tests:** capture current HTTP request/response behavior and critical Firestore transaction semantics.
- **Phase 2 — Extract identity and repository ports:** add interfaces while keeping Firebase adapters as the only active implementation. No behavior change.
- **Phase 3 — Extract domain logic:** keep money/order calculations pure and provider-neutral; preserve existing test vectors.
- **Phase 4 — Candidate adapter:** choose Supabase or AWS only after billing and operational requirements are known; implement in a separate staging-only module.
- **Phase 5 — Data migration rehearsal:** export/import/reconcile with synthetic or approved staging data.
- **Phase 6 — Cutover review:** separate explicit approval required; no automatic switch.

## 9. Scope exclusions

- No change to the live Firebase project, billing account, Blaze plan, Firestore rules, production secrets, Cloud Run deployment, or scheduled worker.
- No change to Paper Investing scope or unrelated website, Crypto, payment, admin, or Mega Kirana features.
- No deletion, rename, or destructive rewrite of existing backend modules.
- No production dual-write, no unverified live-data copy, and no automatic merge/deployment.

## 10. Acceptance criteria

The portability foundation is complete only when:
- The existing Firebase adapter passes the same contract and emulator tests as before.
- Domain/application modules no longer depend directly on Firebase SDK types.
- A second adapter can be tested without changing browser API contracts or paper-trading business rules.
- Financial reconciliation and security tests pass in staging.
- A documented rollback exists and the owner explicitly approves any production cutover.
