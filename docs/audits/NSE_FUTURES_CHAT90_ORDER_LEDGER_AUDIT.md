# Chat 90 — NSE Futures Order and Ledger Audit

**Audit date:** 2026-11-27  
**Repository:** `sharerohit111-pixel/zenura-ignite`  
**Audited integration candidate:** `release/s-trade-mainline-integration-2026-11-25`  
**Exact audited HEAD:** `089fbf91ef2babb44f2bc2a1406374ca980392e2`  
**Evidence type:** GitHub Actions on the exact HEAD plus source/test inspection. No local database or production system was used in this audit.

## Executive verdict

**Order lifecycle and simulated MARKET/LIMIT ledger regression: PASS on the audited candidate.  
Complete NSE Futures financial settlement / production readiness: NOT READY.**

The exact-head disposable PostgreSQL workflow passed and explicitly ran the Futures MARKET accounting reconciliation, LIMIT submit/reserve/cancel/expiry, LIMIT partial/full-fill settlement, and concurrent fill/cancel/duplicate-execution race scripts. This is meaningful automated evidence for the covered paper-trading lifecycle, but it does not prove daily exchange MTM cash settlement, final contract-expiry settlement, live SPAN margin accuracy, multi-level MARKET execution, or production readiness.

Keep `ledgerReconciled=false`. Keep all Futures LIMIT and worker flags disabled unless separately approved. This audit does not authorize merge, production migration, deployment, broker routing, or live orders.

## 1. Exact-head CI evidence

All listed runs are associated with exact HEAD `089fbf91ef2babb44f2bc2a1406374ca980392e2`:

| Workflow | Run | Result | What it establishes |
|---|---:|---|---|
| Paper Trading Supabase SQL smoke test | [45882705526](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45882705526) | SUCCESS | Disposable PostgreSQL 17.12; ordered 45-migration candidate chain; Futures SQL regressions included |
| S-TRADE Futures Options Demo UI Integration | [45882705470](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45882705470) | SUCCESS | Demo F&O integration workflow |
| S-TRADE Demo Screen Wiring Tests | [45882705445](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45882705445) | SUCCESS | Demo screen wiring workflow |
| Validate Indian Market Code | [45882705454](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45882705454) | SUCCESS | Indian-market syntax/gateway validation workflow |

The SQL workflow at this HEAD uses PostgreSQL 17.12, applies the ordered draft migration chain to its disposable service database, and checks that 45 candidate migrations are applied. Its explicit Futures steps are:

- `supabase/tests/futures_market_order_accounting.sql`
- `supabase/tests/futures_legacy_market_backfill.sql`
- `supabase/tests/futures_limit_submit_release.sql`
- `supabase/tests/futures_limit_atomic_fill.sql`
- `supabase/tests/futures_limit_fill_cancel_race.sh`

The GitHub job conclusion is `success`. No failed or skipped Futures test is reported by the job-level evidence retrieved for this audit. This report does not claim a separate manual local PostgreSQL execution.

## 2. MARKET order lifecycle and accounting

**Covered by disposable SQL assertions:**

- Opening long Futures position and reserving margin.
- Exact idempotent retry without a second debit/reservation.
- Changed idempotency fingerprint rejected before mutation.
- Partial close releases proportional position/account margin and records realized P&L.
- Full close releases residual margin and removes the flat position.
- Long-to-short reversal and short close accounting.
- Excessive margin rejection without mutating account state.
- Stale close-only position snapshot rejection.
- Repeated one-lot closes release only their own reservation.
- Stale quote and expired contract rejection.
- Sub-ledger reconciliation against shared account totals.

The SQL reconciliation explicitly checks:
- Account reserved margin equals summed open-position reserved margin.
- Account realized P&L equals filled-order realized P&L.
- Cash equals starting cash + realized P&L − recorded charges.
- The fixture's aggregate realized P&L is 50,000 paise, aggregate charges 6,000 paise, and expected cash 100,044,000 paise.

These are deterministic test-fixture amounts, not current market quotes, official margins, or a live broker contract note.

**Boundary:** The existing MARKET transaction test path is a single execution price per order. A complete multi-level depth sweep with atomic per-level fill legs and fee/position reconciliation is not established by this evidence. The multi-level MARKET design remains a separate dependency/review item.

## 3. LIMIT lifecycle, margin and reservation

**Covered by disposable SQL assertions:**

- Opening BUY LIMIT reserves opening margin once.
- Close-only SELL LIMIT reserves only available position quantity and does not reserve opening margin.
- Overlapping close reservations are rejected.
- Existing MARKET SELL cannot consume quantity already reserved by a pending LIMIT close.
- Cancellation is idempotent and releases residual reservation once.
- Session/order expiry releases residual opening margin once.
- Exact submit/fill replay is a no-op; altered fingerprint or execution payload is rejected.
- Partial opening fills transfer reservation from order to position while conserving account margin.
- Weighted average entry price is checked.
- Partial close releases proportional margin and realizes P&L; final close releases the exact remainder.
- Worse-than-limit execution is rejected.
- RPC grants are checked for least privilege.

The synthetic LIMIT fixture checks a 200,000-paise opening-margin reservation across 10-unit and 15-unit fills, then checks close-side realized P&L and final margin/cash reconciliation.

## 4. Charges and P&L

The LIMIT worker computes incremental cumulative charges by comparing the charge total before and after each added fill, avoiding repeated brokerage-cap charging on each partial fill. SQL settlement receives the charge delta and updates order/account accounting atomically.

The MARKET accounting SQL independently checks aggregate recorded charges and the cash equation described above. LIMIT SQL checks charges are applied on fill and exact replay does not create a second charge.

**Not established:** An independent external golden-vector audit against a currently effective NSE/SEBI/Upstox fee schedule, official SPAN/exchange margin, daily settlement-price feed, or broker contract note. The test fixture proves internal arithmetic consistency only.

Unrealized P&L remains a valuation result; the audited lifecycle does not prove daily MTM cash posting.

## 5. Duplicate and concurrent execution

The LIMIT race script deliberately delays terminal row updates to exercise:

1. Fill wins the account/order lock; later cancel observes the terminal fill.
2. Cancel wins the lock; later fill is rejected.
3. Two concurrent deliveries of the same provider execution ID produce one fill only.

Final SQL assertions check terminal statuses, no position creation for a cancelled order, exactly one fill for the duplicate execution, and no leaked reservation beyond the expected fixture margin.

**Gap:** The current named Futures race script is LIMIT fill/cancel/duplicate execution coverage. A dedicated MARKET-vs-MARKET same-account margin contention race and cross-asset shared-account concurrent reservation stress test are not demonstrated by this Futures-specific evidence.

## 6. Expiry and settlement boundary

Pending LIMIT order expiry and release of its unfilled reservation are tested. Contract-expiry checks reject fills after the contract cutoff.

This is not the same as final contract settlement. The audited candidate does not establish an executable authoritative NSE Clearing final settlement-price import, provenance verification, atomic final cash settlement, residual margin release, or replay-safe terminal settlement record. Daily variation-margin cash posting is also not established. Intraday square-off is a separate rule and must not be inferred from contract-expiry handling.

## 7. Findings and required follow-up

| ID | Severity | Finding | Required action |
|---|---|---|---|
| F-01 | HIGH | Daily MTM and final contract-expiry cash settlement are not proven implemented | Separate approved settlement design, trusted official settlement source/provenance, transactional SQL and disposable-PG replay/concurrency tests |
| F-02 | HIGH | MARKET multi-level depth sweep and atomic per-level settlement are not established | Approve shared accounting contract; implement isolated Futures-only batch settlement with per-level immutable fills and all-or-nothing insufficient-depth behavior |
| F-03 | HIGH | Current Futures evidence does not include a dedicated concurrent MARKET margin-contention race | Add same-account competing MARKET BUY/opening orders and cross-engine reservation stress tests; assert no over-reservation |
| F-04 | MEDIUM | Charges and margin fixtures prove internal consistency, not external tariff/SPAN correctness | Add dated, source-backed golden vectors and independent fee/margin review; never label simulation inputs as official margin |
| F-05 | MEDIUM | LIMIT race coverage is present, but multi-instance worker operational rehearsal is not established by this exact-head SQL run | Keep worker disabled; conduct disposable multi-instance lease/heartbeat/session-close rehearsal before any enablement |

## 8. Safety and scope confirmation

- No production orders or broker orders were submitted.
- No hosted/production database writes or migrations were performed by this audit.
- No deployment, merge, or feature-flag activation was performed.
- No Crypto files or workflows were changed.
- This audit adds documentation only.
- All release and reconciliation claims remain fail-closed; `ledgerReconciled=false`.

## Source evidence

- [Exact-head SQL workflow](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45882705526)
- [Futures/Options Demo integration workflow](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45882705470)
- [Futures MARKET accounting SQL](https://github.com/sharerohit111-pixel/zenura-ignite/blob/089fbf91ef2babb44f2bc2a1406374ca980392e2/supabase/tests/futures_market_order_accounting.sql)
- [Futures LIMIT submit/release SQL](https://github.com/sharerohit111-pixel/zenura-ignite/blob/089fbf91ef2babb44f2bc2a1406374ca980392e2/supabase/tests/futures_limit_submit_release.sql)
- [Futures LIMIT partial-fill SQL](https://github.com/sharerohit111-pixel/zenura-ignite/blob/089fbf91ef2babb44f2bc2a1406374ca980392e2/supabase/tests/futures_limit_atomic_fill.sql)
- [Futures LIMIT concurrency race script](https://github.com/sharerohit111-pixel/zenura-ignite/blob/089fbf91ef2babb44f2bc2a1406374ca980392e2/supabase/tests/futures_limit_fill_cancel_race.sh)
- [Exact-head CI workflow definition](https://github.com/sharerohit111-pixel/zenura-ignite/blob/089fbf91ef2babb44f2bc2a1406374ca980392e2/.github/workflows/paper-trading-supabase-migrations.yml)
