# Indian Market NSE Equity Paper Trading — Lifecycle Audit

**Audit date:** 2026-11-23  
**Scope:** NSE/BSE cash equities only; MARKET and LIMIT; DELIVERY and INTRADAY; order lifecycle, reservations, cash accounting, charges, realized/unrealized P&L, idempotency and paper settlement.  
**Explicit exclusions:** Crypto, Futures, Options, Paper Investing, production migration and production deployment.

## Repository and branch baseline

- Repository: `sharerohit111-pixel/zenura-ignite`
- Default branch: `main` at `a26932c61fc7c147e0abb7b5d44a6d3c2dc4784b`
- Existing Indian Market integration: Draft PR #83, head `integration/supabase-native-auth-professional-launch-2026-11-22`, head SHA `72131c2b4e09b245d6570511f5b6bfc143c9e784`, base `integration/firebase-supabase-migration-validation-2026-11-22`.
- This audit branch: `feature/indian-equity-lifecycle-audit-2026-11-23`, created from the PR #83 head to avoid modifying `main` or the shared integration branch.
- PR #83 is open and Draft. It must remain unmerged and undeployed until release gates are independently satisfied.

## Architecture observed in the PR #83 branch

- Supabase-native Auth/JWT and RLS-backed data model.
- Browser market workspace under `markets/stocks/`; server-side Upstox/provider access and order execution under `market-gateway/`.
- PostgreSQL RPCs perform atomic account, position, order and reservation updates. The gateway supplies authenticated identity, validates the official instrument master and obtains provider quotes; browser-supplied prices are not the trusted execution price.
- Cash-equity positions are keyed by user, product (DELIVERY/INTRADAY) and instrument. Available cash subtracts both pending cash reservations and Futures margin reservations.
- Equity MARKET execution is one atomic full fill. DELIVERY LIMIT and INTRADAY LIMIT use separate submit/fill/cancel/expiry RPC paths and worker/session policies.
- Charges are represented in integer paise; order receipts retain a charge breakdown and cash delta. BUY charges enter cost basis; SELL net proceeds drive realized P&L.
- Portfolio valuation uses fresh provider quotes and exact stored cost basis; stale positions are identified rather than silently treated as fresh.
- BSE fee handling is based on an imported scrip-group fee master, not an assumed universal BSE rate.

## Verified capabilities in the PR branch

| Area | Finding |
|---|---|
| MARKET BUY/SELL | Implemented in `execute_paper_market_order`; validates positive quantity/price, NSE scope in the initial migration, quote freshness, account reservations, position quantity and cash; atomic full fill. |
| DELIVERY | Separate position key and realized-P&L accumulator; delivery MARKET fees include delivery STT/stamp and estimated sell-side DP charge. |
| INTRADAY | Separate position key and realized-P&L accumulator; intraday MARKET fee rules are distinct. |
| DELIVERY LIMIT | Submit reserves limit gross plus estimated BUY fees or unreserved shares for SELL; full-fill execution rechecks quote/order/reservations under locks; cancel/expiry releases remaining reservation. |
| INTRADAY LIMIT | Dedicated submit/fill/cancel/expiry RPCs; verified exchange-session gate, fresh quote requirement and separate worker lease key. |
| Idempotency | User-scoped idempotency key plus request fingerprint; replay returns stored receipt; key reuse with a different fingerprint is rejected. |
| Accounting | Integer-paise gross, charge breakdown, cash delta, fee-inclusive BUY cost basis and net-proceeds SELL realized P&L. |
| Unrealized P&L | Valuation module uses exact cost basis and fresh quotes; stale/unavailable quotes are surfaced. |
| Access control | The live project currently exposes order RPC execution to service_role only; functions are SECURITY DEFINER with empty search_path. |

## Material gaps / release blockers

### 1. Production Supabase is behind the Git branch

Read-only inspection of project `zenura-paper-trading` (`atvbjibhunvzpmfagagm`) on 2026-11-23 found only 15 recorded migrations, ending at `20261122123415`. The PR branch contains later draft equity migrations dated 2026-11-23, including NSE MARKET fee accounting, NSE LIMIT fee accounting, BSE fee master and BSE fee-aware settlement. These later migrations are **not** recorded in the live project.

The live `paper_orders` table has no `charges_paise`, `charges_breakdown` or `cash_delta_paise` columns. The live equity order RPC inventory contains only:
- `execute_paper_market_order`
- `submit_paper_limit_order`
- `execute_paper_limit_fill`
- `cancel_paper_limit_order`

The live project does not yet have the newer INTRADAY LIMIT RPCs. This is expected under the no-production-migration constraint; do not apply them as part of this task.

### 2. No dedicated immutable cash ledger or equity fill ledger

The current equity model stores account cash as an aggregate and cash deltas/charges on order receipts. The live schema and inspected PR branch do not provide a dedicated append-only cash-ledger table or immutable equity fill/execution table. This weakens independent reconciliation, audit history and replay diagnostics. A dedicated ledger design should record every cash movement (trade debit/credit and reservation/release events where applicable) with a unique event identity and a foreign key to the originating order/fill.

### 3. LIMIT lifecycle is full-fill only, not partial-fill

The equity LIMIT SQL paths move an eligible order directly to `FILLED`; the order status constraint observed in the live schema permits only `PENDING`, `FILLED`, `CANCELLED`, `REJECTED`. There is no `PARTIALLY_FILLED` state, cumulative fill quantity, remaining quantity, weighted-average fill price, or immutable fill rows for cash equities. Current behavior is therefore a complete **single/full-fill** LIMIT lifecycle, not an exchange-like partial-fill lifecycle.

### 4. Settlement semantics need an explicit product decision

Current paper MARKET and LIMIT fill functions immediately mutate virtual cash and positions in the same transaction. This is atomic paper execution settlement, not a separate T+1/T+0 clearing/settlement ledger. If settlement-date modelling is required, it needs explicit trade-date/value-date records and unsettled cash/holdings rules. Do not imply real exchange settlement or broker contract-note accuracy.

### 5. Fee schedules are indicative and must be independently refreshed

NSE fee functions use a versioned indicative schedule and integer-paise rounding. BSE uses imported scrip-group/exclusive-category inputs and fails closed where the classification is missing. Verify current exchange/statutory schedules, brokerage assumptions and DP applicability before release; the simulator must label charges as indicative. Do not silently substitute NSE rates for BSE.

### 6. Partial lifecycle and concurrency coverage still required

Before calling equity execution release-ready, add disposable-PostgreSQL tests for:
- Cash-ledger conservation across MARKET BUY/SELL, DELIVERY and INTRADAY LIMIT fill, cancel and expiry.
- Duplicate submit/fill/cancel retries and idempotency-key fingerprint mismatch.
- Two concurrent SELL orders competing for the same shares.
- Fill-vs-cancel race and duplicate worker execution.
- Reservation conservation (available + reserved cash never exceeds account cash; reserved shares never exceed position quantity).
- Position cost-basis conservation over repeated partial closes, if partial fills are implemented.
- Cross-product isolation (same instrument in DELIVERY and INTRADAY must remain separate).
- RLS/tenant isolation and service-role-only RPC grants.
- Stale, future-dated, unsupported-exchange and out-of-session quotes fail without mutating order, account or position state.

## Verification recorded

- GitHub Actions workflow `Paper Trading Supabase SQL smoke test` run #979 (PR) and #978 (push) passed on PR #83 head `72131c2b4e09b245d6570511f5b6bfc143c9e784` on 2026-11-23. This validates the branch's current migration chain, gateway regression suite and disposable PostgreSQL assertions; it does not validate the production Supabase schema because no production migration was run.
- Read-only Supabase inspection confirmed the project is ACTIVE_HEALTHY, Postgres 17.12, with 15 migrations. The equity MARKET/DELIVERY LIMIT RPCs are service_role-only, SECURITY DEFINER and pinned to empty search_path.
- Supabase Security Advisor returned six INFO-level `rls_enabled_no_policy` findings for internal service-only tables (`paper_margin_preview_limits`, `paper_market_stream_leases`, `paper_market_worker_state`, `upstox_connection_controls`, `upstox_connections`, `upstox_oauth_states`). These are not equity client-readable tables, but their grants and intended service-only access should remain in the security review.
- No production SQL was written, no migration was applied, no deployment was triggered, and no branch was merged.

## Next implementation sequence (equity only)

1. Add append-only `paper_equity_cash_ledger` and immutable `paper_equity_fills` design with unique event/execution identities, RLS, indexes and service-role-only write RPCs.
2. Extend MARKET, DELIVERY LIMIT and INTRADAY LIMIT transactions to write ledger/fill records atomically without changing their accounting outcomes.
3. Decide whether partial fills are required. If yes, introduce `PARTIALLY_FILLED`, cumulative/remaining quantities, weighted average price, proportional fee allocation and fill-vs-cancel serialization; never simulate this by repeated full fills.
4. Add cross-path ledger reconciliation and concurrency race tests in disposable PostgreSQL.
5. Verify staging with authenticated users and approved market-data rights before any separately approved production release.

**Safety:** All work remains on this isolated feature branch. Do not touch Crypto/Futures/Options files, do not apply production migrations, do not deploy, and do not merge without separate approval.
