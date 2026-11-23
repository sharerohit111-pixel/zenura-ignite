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


## Follow-up implementation — verified MARKET session and tick validation

Implemented on the isolated equity branch:

- MARKET order requests now load the exact NSE/BSE session row for the current Asia/Kolkata date using the existing `loadVerifiedExchangeSession` helper.
- MARKET orders fail closed unless the calendar row is verified, sourced, trading-day eligible, and the current time is inside its official REGULAR/SPECIAL session window.
- The provider quote timestamp must also fall inside that same verified session window.
- MARKET execution prices are checked against the official instrument tick size before the execution RPC is called.
- LIMIT ticket tick validation now uses the new equity-only validator rather than importing the derivative contract module.
- Added isolated tests for equity tick-size normalization and execution-price alignment.
- No database schema, SQL RPC, shared accounting, Crypto, Futures or Options code was changed.

**Implementation commits**
- `688a5439fd0be3d53bc1bec4ca92a4bba0a1dbcc` — MARKET session and tick validation.
- `74ec8b06d1737365be4374a63db43464ed5746ec` — isolated equity tick validator.
- `585d55055620d6e5d7e1bead8492f1396171ac24` — tick validation unit tests.
- `85cf9aca4ddc01042042cdeaa1e4f8ba2461576e` — strict integer-paise tick predicate.

**CI:** GitHub Actions run `45151983771` was in progress at the time of this update. Its completed initial checks were successful; the full market-gateway regression suite and disposable PostgreSQL migration tests had not yet reported a final result.

**Still pending:** LIMIT partial fills, persistent PARTIALLY_FILLED lifecycle, atomic execution-to-ledger integration, and end-to-end PostgreSQL race tests. These remain gated on approval from the shared accounting/database owner where schema or settlement semantics are affected.

## CI verification and LIMIT partial-fill design audit — 2026-11-23

**Verified CI run:** [45152566344](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45152566344) completed with conclusion **success** on commit `1a4d43484eb9c6e27c01327336210b67d57f57e2`. The workflow's complete market-gateway regression suite, disposable PostgreSQL migration smoke tests, container build, security checks, existing MARKET settlement/idempotency tests, LIMIT reservation lifecycle checks, and existing concurrency checks all passed. This is evidence for the tested current implementation only; it is not evidence that partial fills are implemented.

### Confirmed current LIMIT fill behavior

Inspection of the latest ordered cash-equity settlement migrations confirms:

- DELIVERY `execute_paper_limit_fill` accepts a single execution price and processes the entire `v_order.quantity`; its eligibility condition requires `status='PENDING'`.
- INTRADAY `execute_paper_intraday_limit_fill` follows the same pending-to-filled, whole-order execution model.
- Both paths set `status='FILLED'`, release the full reservation, and set one order-level execution price/gross/charges/cash delta/realized P&L result. There is no cumulative fill quantity or remaining quantity update in these functions.
- The current append-only `paper_equity_fills` table (PR #92 foundation) can represent individual executions, but its migration explicitly does not wire any MARKET/LIMIT RPC to it. The cash ledger is likewise schema-only.
- Current SELL settlement allocates cost basis for the whole order quantity in one calculation. Partial executions would require proportional, deterministic cost-basis allocation and rounding conservation across multiple fills.
- Current BUY settlement computes charges for the whole execution in one calculation. A partial-fill design must define per-fill versus order-level minimum brokerage and other fee rounding so cumulative charges reconcile exactly.

### Safe design requirements — no schema/RPC changes authorized or made

Before implementation, the shared database/accounting owner must approve a single transaction contract covering:

1. Order state: `PENDING → PARTIALLY_FILLED → FILLED`, with immutable total quantity and monotonic cumulative filled quantity; remaining quantity must equal total minus cumulative.
2. Fill identity: client/worker execution idempotency key plus unique `(order_id, execution_id)`; retries must return the original fill receipt without reapplying cash, shares, fees or P&L.
3. BUY reservation: consume only the executed portion of reserved cash, keep the remainder reserved for open quantity, and release only the unfilled remainder on cancel/expiry.
4. SELL reservation: consume only executed reserved shares; preserve remaining share reservation; reject any fill/cancel race that would over-consume shares.
5. Price accounting: maintain cumulative executed quantity, cumulative gross, weighted average execution price and deterministic paise rounding.
6. Fees: specify whether minimum brokerage is per order or per execution, and reconcile fee deltas across partial executions and final completion/cancellation.
7. SELL cost basis: allocate basis incrementally using a deterministic remainder rule so the sum of all partial allocations plus residual position basis equals the original basis exactly.
8. Atomic audit: insert each immutable fill row and corresponding cash-ledger event in the same SQL transaction as order/account/position/reservation changes.
9. Concurrency: account-first lock order, then order and position locks; test concurrent duplicate fill, fill-vs-cancel, competing SELL, retry-after-commit and multi-worker lease behavior in disposable PostgreSQL.
10. MARKET behavior remains atomic full fill unless a separately approved execution model explicitly changes it.

No shared database schema, accounting RPC, worker, Crypto, Futures or Options implementation was modified as part of this audit. No migration was applied to production, no deployment occurred, and PR #94 remains Draft/unmerged.
