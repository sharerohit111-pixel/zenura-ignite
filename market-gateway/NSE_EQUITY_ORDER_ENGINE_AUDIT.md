# NSE Equity Order Engine — Repository Audit

**Audit date:** 2026-11-23  
**Repository:** `sharerohit111-pixel/zenura-ignite`  
**Dedicated work branch:** `feature/nse-equity-order-engine-2026-11-23`  
**Branch base:** `aea81ca8eed32e4b9c614eb39547ccf761f4d409` (existing equity audit branch / PR #92 head)  
**Scope:** NSE cash-equity MARKET and LIMIT order engine, DELIVERY and INTRADAY, BUY/SELL, validation, lifecycle, idempotency, concurrency and session controls.  
**Excluded:** Crypto, Futures and Options runtime; production migration/deployment; unapproved shared accounting/schema modifications.

## Repository and PR baseline

- Default branch `main`: `a26932c61fc7c147e0abb7b5d44a6d3c2dc4784b`.
- Main Indian-market integration branch: `integration/supabase-native-auth-professional-launch-2026-11-22`, head `72131c2b4e09b245d6570511f5b6bfc143c9e784`, tracked by Draft PR #83.
- Equity ledger foundation: Draft PR #92, head `aea81ca8eed32e4b9c614eb39547ccf761f4d409`, based on the Indian-market integration branch.
- PR #92 adds `paper_equity_fills` and `paper_equity_cash_ledger` append-only schema foundations and disposable PostgreSQL schema/immutability assertions. It explicitly does not connect the existing MARKET/LIMIT RPCs to these tables.
- The dedicated work branch was created from PR #92 head to preserve the in-progress equity-only changes without modifying the shared integration branch.

## Existing architecture observed

- Browser equity workspace: `markets/stocks/` (order workspace, stock workspace, retry policy, protective-order UI).
- Authenticated backend: `market-gateway/supabase-server.js`.
- PostgreSQL transaction functions: `supabase/migrations/`, using Supabase service-role-only RPC execution for trusted order mutations.
- Official instrument identity and tick metadata come from the Upstox instrument master; browser-supplied execution prices are not used for MARKET fills.
- MARKET execution uses a server-side Upstox quote and PostgreSQL RPC. The SQL transaction locks the paper account before reading/writing the order and position, serializing same-user cash and position mutations.
- DELIVERY LIMIT and INTRADAY LIMIT have separate submit/cancel/fill/expiry functions and worker/session policies.
- Cash/charges are represented in integer paise. MARKET and LIMIT settlement updates cash, positions, reservations, charges and realized P&L in one SQL transaction.
- PR #83 remains Draft; it documents that production migrations, deployment and merge have not occurred.

## Capability matrix and findings

| Requirement | Existing implementation | Audit finding |
|---|---|---|
| MARKET BUY/SELL | `execute_paper_market_order` | Implemented as atomic full fill; no partial MARKET fills. |
| DELIVERY / INTRADAY MARKET | Separate position keys and realized-P&L buckets | Implemented; product isolation exists. |
| DELIVERY LIMIT | `submit_paper_limit_order`, `execute_paper_limit_fill`, cancel and expiry | Implemented as reserve-then-single-full-fill. |
| INTRADAY LIMIT | Dedicated submit/cancel/fill/expiry RPCs and worker | Implemented behind worker readiness/feature gating; verified session calendar is required. |
| Order validation | BUY/SELL, MARKET/LIMIT, product, whole quantity 1..1,000,000, positive paise price, official EQ instrument identity | Most basic validation exists. |
| Tick size | Gateway validates LIMIT price against official instrument tick metadata | LIMIT path covered. MARKET quote execution tick alignment is not explicitly checked in the inspected route/RPC path. |
| Market session | Intraday LIMIT submit/fill checks verified session snapshots and quote timestamps | Explicit MARKET session gate was not found in the inspected `/paper/orders` route or MARKET SQL RPC. This requires dedicated verification/fix. DELIVERY LIMIT worker/session behavior also needs end-to-end test evidence. |
| Partial fills | LIMIT fill RPC transitions PENDING directly to FILLED for the entire order quantity | Not implemented for cash equities. No equity PARTIALLY_FILLED lifecycle, cumulative filled/remaining quantity, weighted average fill price or per-execution fill processing was found. |
| Cancellation / rejection | LIMIT cancel and expiry release reservations; validation/RPC failures reject requests | Implemented for pending LIMIT cancellation. A formal persisted REJECTED receipt for every pre-acceptance validation failure is not established. |
| Duplicate prevention / idempotency | User-scoped UUID idempotency key, deterministic order ID, request fingerprint, SQL replay checks | Implemented in the inspected MARKET and LIMIT transaction paths; changed-payload key reuse is rejected. |
| Concurrency | Account-first row lock, then order/position re-read and locks | Strong serialization foundation exists. Needs PostgreSQL race tests covering all BUY/SELL, fill/cancel and competing SELL combinations. |
| Cash accounting | Fee-aware atomic cash/position/cost-basis/realized-P&L mutation | Existing shared accounting logic is present; do not alter without accounting owner approval. |
| Immutable audit ledger | PR #92 schema foundation only | Tables are not yet written atomically by MARKET/LIMIT RPCs; ledger integration is pending and shared-accounting-owner gated. |

## Confirmed release blockers / next work

1. Add a verified MARKET session gate using the trusted exchange session calendar; fail closed for missing, unverified, closed or out-of-window sessions. The MARKET route currently proceeds from instrument validation to provider quote and RPC without an explicit session-calendar check in the inspected code.
2. Add official tick-size validation for normalized MARKET execution prices, not only LIMIT ticket prices. Reject invalid provider price precision before any SQL mutation.
3. Implement equity LIMIT partial fills only after approval from the shared accounting/database owner. This requires coordinated schema and RPC changes: PARTIALLY_FILLED status, cumulative/remaining quantity, immutable per-fill rows, proportional cash/share reservation consumption, fee-delta allocation, weighted average price, realized P&L basis allocation, and serialized fill-vs-cancel behavior.
4. Connect PR #92 fill and cash-ledger records atomically to each relevant execution only with shared accounting owner approval. Current schema-only records must not be described as live execution audit coverage.
5. Add disposable PostgreSQL tests for MARKET session/tick rejection, DELIVERY and INTRADAY separation, duplicate submit replay, fingerprint mismatch, concurrent identical submissions, competing SELL orders, fill-vs-cancel, duplicate worker execution, reservation conservation and accounting conservation.
6. Verify gateway route behavior, worker readiness, SQL RPC grants, RLS/tenant isolation and current ordered migration chain. CI on PR #92 head was pending at the time of this audit (commit status returned pending with zero reported statuses); do not infer a passing test run from source inspection.

## Change boundary

- This audit commit changes documentation only.
- No shared SQL/accounting component is modified.
- No Crypto, Futures or Options runtime file is modified.
- No production migration, deployment, feature activation or merge is performed.
- Follow-up SQL/accounting work must wait for the relevant shared-component owner approval. Until then, implement only isolated gateway validation/policy and tests that do not mutate shared accounting/database contracts.
