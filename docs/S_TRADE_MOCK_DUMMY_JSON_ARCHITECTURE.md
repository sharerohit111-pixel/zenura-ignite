# S-TRADE Mock/Dummy JSON Architecture and Integration Plan

Date: 2026-11-24  
Status: architecture baseline + isolated test-fixture implementation  
Scope: Indian Market Paper Trading only (NSE/BSE). Crypto is excluded.

## Guardrails

- This package is a deterministic **test/demo fixture source**, not a market-data provider, broker adapter, order engine, ledger, or production fallback.
- No live API, Upstox connection, exchange feed, broker order route, or deployment is added by this change.
- The fixture store is not imported by `supabase-server.js`; it cannot silently replace the existing authenticated API.
- The fixture loader refuses `NODE_ENV=production`. Every fixture must carry `mode=MOCK` and `simulated=true`.
- Existing order execution, reservations, worker leases, charges, ledger RPCs, RLS, quote freshness and margin policies remain authoritative. Do not copy their business rules into mocks.
- All monetary values are integer paise. Quantities and lots are integers. Timestamps are ISO-8601 with explicit offset/UTC.
- Synthetic symbols and instrument keys are deliberately non-tradable (`MOCK*`); they are not real NSE/BSE securities or market prices.

## Existing-code and PR inventory

Repository inspected: `sharerohit111-pixel/zenura-ignite`; current integration base for this work: `feature/s-trade-distributed-api-rate-limit-2026-11-24`. The code tree already contains a Supabase-native gateway, a modular order/market-data library, frontend workspaces, SQL migrations, and PostgreSQL/Node regression suites. This is an extension, not a greenfield rebuild.

| Existing area | Evidence in current branch / PR inventory | Integration treatment |
|---|---|---|
| Core Paper account, identity/RLS, orders and equity | PR #83 baseline; migrations for account initialization, order transactions, authenticated RLS and Supabase runtime | Reuse; do not add a second account or order model |
| Equity MARKET/LIMIT, protective exits, cash/charges | Existing paper order RPCs, `paper-order-transaction`, `pending-limit-order-transaction`, protective workers and equity fee migrations; PRs #92/#100/#111 | Existing ledger/RPC remains source of truth |
| Futures execution and LIMIT partial fills | PRs #87–#89, #93, #96, #107/#109/#114; `paper-futures-limit-worker`, futures reservation/atomic-fill migrations | Reuse lifecycle; no mock fill engine |
| Options CE/PE and LIMIT | PR #91 schema, #97 tests, #98 reservation expiry, #113 worker hardening, #117 fixture isolation, #118/#119 worker fixture/heartbeat, #122 read model, #128/#129 hardening | Reuse options lifecycle and read model |
| Market instruments, watchlists, charts and depth | PRs #121, #123/#126, #124, #134; existing BOD master, chart and watchlist modules | Fixture only for UI/test contract; no second instrument master |
| User identity and wallet | PR #131 is draft; current wallet snapshot explicitly says `ledgerReconciled=false` | Preserve as snapshot; do not claim unified cross-asset ledger until reconciled |
| Frontend workspace and language | PR #130 and existing equity/Futures/Options workspaces | Bind screens to shared shapes; preserve honest unavailable/empty/error states |
| Notifications/admin/security | PR #136 draft | Out of scope for mock engine; integrate via existing authenticated services |
| Futures risk/MTM/settlement | PR #108/#110/#112/#132/#135 | Separate domain boundary; no duplicate margin/settlement calculation |
| API rate limits | PR #125 | Keep existing server-side limiter; mock fixtures do not bypass it |
| Provider security | PR #115/#121 | No provider adapter is activated by this fixture architecture |
| Crypto | PR #84/#85 and crypto paths | Explicitly excluded; no files or schemas changed |

Superseded draft handling: #132 was closed in favour of #135; #133 was closed in favour of #134; #123 is an earlier Futures instrument draft and #126 is the refreshed foundation. PR #119 is merged. Most other Indian-market PRs listed above remain independent Draft/open branches; do not assume they are all present on one branch or merge them merely because their metadata is visible. Review exact-head CI and migration ancestry before any consolidation.

This is a repository/PR metadata and current integration-branch source inventory, not a claim that every unmerged PR patch has been merged or that the production system is release-ready.

## Shared envelope (v1)

Every mock response uses the same top-level envelope:

- `schemaVersion`: exact contract version (`1.0.0`)
- `mode`: `MOCK` for fixtures; a real authenticated backend response is never relabelled as mock
- `simulated`: always `true` for fixture data
- `requestId`: stable fixture request identifier for test correlation
- `asOf`: fixture snapshot time, not a live quote timestamp
- `meta.source`: `SYNTHETIC_FIXTURE` for fixture payloads or `PAPER_LEDGER` for backend-owned paper records
- `data`: module-specific object

Canonical schemas: `market-gateway/mock/contracts/paper-trading-envelope.schema.json` (shared envelope) and `market-gateway/mock/contracts/paper-trading-domain.schema.json` (instrument, quote, order, position and account domain shapes).

## Module contracts and ownership

| Module | Fixture / domain payload | Authoritative existing owner |
|---|---|---|
| Market snapshot | `market.json`: exchange/session, synthetic quotes and shallow depth | Existing market-data validation, feed router and freshness policy |
| Account/wallet | `account.json`: INR, starting/cash/blocked/available funds, P&L and reconciliation flag | Authenticated account route and ledger/RPC; fixture is not a wallet |
| Equity | `equity.json`: product, instrument, order and position view | Existing Equity order RPC, reservation and position/portfolio read model |
| Futures + Options | `derivatives.json`: distinct FUT and CE contracts, lot/tick/expiry and order examples | Existing Futures/Options contract validators, workers, margin and accounting RPCs |
| Errors | `error.json`: stable error envelope | Gateway error mapper; never expose stack traces or secrets |

## Integration topology

```text
Frontend workspaces (Equity / Futures / Options / Portfolio)
            | shared request/response contracts
            v
Authenticated Supabase Gateway (existing)
            | verified user + RLS + rate limit
            v
Existing domain modules / atomic RPCs / worker leases
            | append-only paper ledger + read models
            v
Account / orders / trades / positions / holdings / P&L

Test-only fixture store ---> contract/unit/UI tests only
                           X no route to production gateway
                           X no provider or broker fallback
Crypto ---------------------- separate project boundary
```

## Recommended integration sequence

1. **Contract freeze:** review schema changes with frontend, gateway, SQL/RPC and QA owners. Additive fields only within a contract version; breaking changes require a new version and coordinated consumer update.
2. **Consumer adapters:** make each existing screen consume a typed/validated response adapter. Do not let UI components read raw provider payloads or invent fills.
3. **Backend verification:** map every route to its existing authenticated RPC/domain owner. Validate request and response envelopes at boundaries; keep ownership checks and RLS in the backend.
4. **Ledger convergence:** reconcile Equity, Futures and Options ledgers before presenting a unified available-funds/P&L number. PR #131 explicitly marks its wallet snapshot unreconciled.
5. **History/read models:** standardize pagination cursor, stable IDs, IST display formatting, and status enums without changing persisted IDs or order lifecycle.
6. **Contract tests:** run the same fixtures against frontend adapters and backend response validators; add regression cases for null/empty arrays, stale/future quote, partial fill, cancellation race, reservation expiry, margin unknown, and per-user isolation.
7. **Release gates:** exact-head CI, disposable PostgreSQL migration chain, RLS/security tests, worker concurrency tests, mobile UI smoke and independent review. No production migration/deployment is part of this work.

## Fixture store

`lib/paper-mock-fixtures.js` is deliberately not wired into server routes. It returns detached copies, rejects unknown names and malformed envelopes, and refuses production mode. It is intended for deterministic Node tests and UI development harnesses only. Do not add a runtime environment switch that silently routes signed-in users from the authenticated gateway to fixtures.

## Verification

From `market-gateway`:

```sh
node --test test/paper-mock-fixtures.test.js
npm test
npm run check
```

The focused fixture tests assert the envelope, synthetic capital amount, immutable source copies, unknown-name rejection and production guard. Full CI and disposable PostgreSQL verification remain required for the combined Indian Market PR stack; this isolated mock-fixture addition does not certify those independent PRs.
