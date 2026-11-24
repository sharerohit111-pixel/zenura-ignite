# S-TRADE Futures & Options Dummy JSON Mode — Audit

Date: 2026-11-24
Repository: sharerohit111-pixel/zenura-ignite
Base: PR #137 shared Mock/Dummy JSON architecture head
Scope: isolated Indian-market Futures and long CE/PE Options demo workspace

## Existing implementation audited

### Futures
- PR #87: Futures LIMIT order/fill ledger fields and immutable fill table.
- PR #88: atomic LIMIT submission, opening-margin / close-quantity reservation, cancellation and expiry RPCs.
- PR #89: atomic partial/full fill settlement, quote snapshot validation, authenticated routes and the bounded LIMIT worker.
- PR #93: owner-bound worker lease heartbeat, lease-loss fencing, safe cursor handling and session-aware expiry.
- PR #96 and #114: Futures order boundary, session/tick checks and executable best-bid/best-ask MARKET policy.
- PR #107: multi-level MARKET execution design; PR #109: isolated depth sweep helper.
- PR #108/#112 and PR #135: separate Futures risk/settlement design and risk-ledger work. PR #132 is closed unmerged; PR #135 is the current open Draft risk-ledger candidate.

### Options
- PR #90: long-only CE/PE LIMIT design.
- PR #91: isolated Options LIMIT order/fill tables, reservation, cancellation, expiry, partial-fill RPCs and worker.
- PR #97/#98: worker regression and reservation-expiry hardening.
- PR #113: NSE CE/PE MARKET quote-side validation and LIMIT worker hardening.
- PR #117: unique concurrency fixtures and test cleanup.
- PR #118: authenticated market-test fixture correction.
- PR #122/#129: Options accounting read model, fill/order reconciliation, expiry settlement and invariant hardening.
- PR #128: current owner-bound Options LIMIT worker heartbeat; PR #119 is superseded and must not be duplicated.

These PRs are separate Draft/stacked branches, not a single merged production release. Their order RPCs, SQL accounting, worker leases, idempotency, reservations, charges and RLS remain owned by their respective existing modules.

## Changes in this PR

- Extend the existing shared derivatives.json fixture with synthetic MOCK Futures and CE/PE contracts, multiple expiries/strikes, deterministic bid/ask prices and displayed quantities.
- Add explicit derivative instrument and quote definitions to the shared domain schema.
- Add an isolated browser-only Dummy JSON workspace with Futures/Options selection, expiry/strike filters, Futures Intraday/Delivery, MARKET/LIMIT tickets, order receipts, manual deterministic LIMIT matching, cancellation and open positions.
- Use the existing applyDerivativeFill position helper for position transitions; do not reimplement its average-price or realized-P&L arithmetic.
- Add a small browser export to the existing helper so the isolated static workspace can reuse it; CommonJS consumers and tests retain the same export.
- Add a deterministic simulator harness with whole-lot partial fills, side-correct bid/ask matching, terminal cancellation and close-quantity reservation for long Options SELL orders.
- Fix the shared fixture loader's fixture-directory resolution and its test import path. The loader remains test-only and is not imported by production gateway routes.
- Add focused Node tests for contracts, expiry/strike coverage, Futures long/short positions, CE/PE long-only entry/exit, MARKET rejection on insufficient depth, LIMIT partial/full fills, cancellation and reservation release.

## Non-duplication and safety

- No new SQL migration, table, RPC, order endpoint, cash ledger, fee calculator, margin calculator, worker, lease, provider adapter or auth path.
- The demo simulator runs only in browser memory and uses only MOCK-prefixed instruments and provider MOCK fixture quotes.
- The SIMULATE LIMIT MATCH button is an explicit user action against deterministic fixture depth. It is not a background worker and does not impersonate PR #89/#93/#91/#128 worker logic.
- MARKET execution uses fixture ask for BUY and bid for SELL, and rejects the entire request if the displayed synthetic top-of-book quantity is insufficient.
- LIMIT execution fills only when the fixture ask is at/below a BUY limit or fixture bid is at/above a SELL limit. Partial quantities are whole lots.
- Options are long-only: CE/PE BUY opens/adds; SELL can only close available unreserved long quantity. Short option opening and reversal are rejected.
- Futures BUY/SELL can open, add, reduce or reverse signed demo positions.
- No cash, charges, realized account ledger, opening margin, wallet, real user account or persistent database state is changed. This workspace says so explicitly in the UI and simulator snapshot.
- No live NSE/BSE prices or real tradable symbols are fabricated. All fixture keys and symbols are MOCK-prefixed and marked DEMO DATA.
- No Crypto, Equity order engine, production migration, merge, deployment, feature-flag activation or broker order is included.

## Verification plan

- npm test runs the full market-gateway Node regression suite, including the new simulator tests.
- npm run check syntax-checks the existing gateway and the new browser workspace.
- Shared Mock Contract workflow parses the JSON schemas/fixtures and runs paper-mock-fixtures.test.js.
- Full disposable PostgreSQL migration/security workflows remain owned by the existing backend PRs; this UI/fixture-only PR does not add or apply a migration.
