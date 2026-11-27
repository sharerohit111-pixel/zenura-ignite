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

## 7. Related settlement implementation discovered outside the audited candidate

A separate unmerged Draft, [PR #135 — Futures risk ledger, daily MTM, margin calls and settlement engine](https://github.com/sharerohit111-pixel/zenura-ignite/pull/135), advertises an implementation of an append-only Futures risk event journal, daily MTM posting, provider margin refresh/risk guards, explicit expiry settlement and paper-only square-off. The related branch `feature/s-trade-futures-risk-ledger-v2-2026-11-24` contains the settlement migration and a disposable SQL test file. These files are **not present** on audited candidate HEAD `089fbf91...`; therefore they cannot be counted as part of the Chat 90 candidate.

The related PR #135 head is exactly `3d59ef53022ca5ac9974f31eddd81e528b621186` (base branch `feature/s-trade-futures-risk-accounting-reconciled-v6-2026-11-23`). Its own CI evidence is now verified:
- [Futures risk ledger SQL integration — run #45372767866](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45372767866): SUCCESS. Job `postgres-risk-ledger`; PostgreSQL 16.16 disposable service; all steps completed, including ordered migrations and the dedicated Futures risk/MTM/margin-call/expiry/square-off SQL test.
- [Paper Trading Supabase SQL smoke — run #45372767892](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45372767892): SUCCESS on the same PR #135 head. This is not the current candidate's PostgreSQL 17.12 exact-head run and does not cover the later candidate-only correction migration `20261127100000_correct_protective_fills_and_futures_ledger.sql`.

Read-only source inspection of the related branch found:
- Futures-specific settlement state, risk state and append-only risk-event tables.
- RLS with owner-only SELECT policies and no client mutation grants on the new tables.
- Daily MTM, provider-margin refresh and close/expiry-related `SECURITY DEFINER` RPCs with empty search paths; execute grants are restricted to `service_role`.
- SQL assertions for positive/negative daily MTM, idempotent replay and changed-payload rejection, margin-call risk blocking, square-off accounting, expiry closure, append-only event protection and client privilege boundaries.
- The PR #135 description says its dedicated new risk-ledger settlement workflow was queued; an earlier SQL integration test passed before final guardrail consolidation. That description is not exact-head CI evidence for the current related branch. No verified concurrent duplicate daily-settlement race result was obtained in this audit.

**Disposition:** Do not recreate the same settlement schema/RPCs in Chat 90. First reconcile PR #135 and its branch against the current canonical integration candidate, the ordered Futures LIMIT migrations, and the hosted migration baseline. Then rerun the complete disposable PostgreSQL suite on the exact reconciled head, including two-connection same-session settlement races, long/short signs, stale basis, missing/invalid provenance, expiry idempotency and account/position/order-reservation conservation. Keep the settlement feature disabled until that integration review is complete.

### Related MARKET depth-planner work

- [PR #126 — refreshed NSE Futures instrument master and depth planner](https://github.com/sharerohit111-pixel/zenura-ignite/pull/126) is the current refreshed isolated helper branch. It includes contract normalization, Upstox V3 depth normalization and a pure multi-level BUY-ask/SELL-bid sweep planner with all-or-nothing insufficient-depth behavior. It is not wired to the production Futures MARKET route, SQL/RPC, fill ledger, fees, margin or accounting. No workflow run was found for its exact head `868169fd39fd4f1c26be5343f7319f2f99b19f20`.
- Older [PR #109 — isolated depth-sweep helper](https://github.com/sharerohit111-pixel/zenura-ignite/pull/109) has CI [run #45371656761](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45371656761) SUCCESS, including the explicit helper test step and full market-gateway regression suite. This result belongs to older head `d12940ddbf084c8f0eb7bf643b12f848f178d222`, not PR #126's refreshed head.
- The planner preserves per-level fill legs and computes gross turnover, but it does not atomically persist those legs or reconcile fees, reserved margin, cash, positions and the order receipt. PR #107's design document explicitly leaves atomic multi-fill settlement pending Chat 4 accounting approval.

A second integration candidate, [PR #169 — cross-asset wallet and portfolio migration candidate](https://github.com/sharerohit111-pixel/zenura-ignite/pull/169), also contains the two Futures risk migrations on branch `feature/s-trade-wallet-portfolio-integration-candidate-2026-11-25`. The migration files match the related risk-ledger branch blobs, but the settlement SQL test file was not found on that integration branch. GitHub compare against the current canonical release branch reports `diverged`, 1,278 commits ahead and 63 behind (merge base `6b98ffaf99c9dcc6f5a330e8f83f39066eb20406`); it is not a safe direct-merge candidate. Treat #169 as migration-line evidence only, not as a validated integration. The safe path is a surgical, dependency-reviewed port onto the current candidate with the missing tests restored, canonical migration versions/order reconciled, and full exact-head CI.

## 8. Additional implementation review findings

Source review of the PR #135 settlement migration identified integration gates that its passing fixture does not close:

- **Shared account invariant change:** the migration drops the shared `paper_accounts.cash_paise >= 0` and `reserved_cash_paise + reserved_margin_paise <= cash_paise` checks so Futures variation losses can create a deficit, then adds generated `margin_deficit_paise`. This changes the shared wallet/account contract, not only Futures. It must be reconciled with current wallet/cross-asset accounting and protective-order behavior; do not port as an isolated blind copy.
- **Charges are caller-supplied:** `close_paper_futures_position` accepts `p_charges_paise` and books it, but does not calculate or independently verify the fee breakdown in SQL. No verified settlement-ingestion/worker caller was found in the PR description. Connect it to the canonical dated charge resolver and golden vectors before claiming charge correctness.
- **Source provenance is not self-authenticating:** the RPC checks approved-looking HTTPS hostnames, hash shape and timestamps, but the supplied SHA-256 is not recomputed from fetched official source content inside the database. The PR itself says the official settlement ingestion worker is still missing. Keep all automated settlement processing disabled until a trusted ingestion boundary verifies the source bytes and session/contract mapping.
- **Concurrency/replay coverage is incomplete:** the dedicated SQL fixture tests same-key daily MTM replay and changed-payload rejection, but does not exercise two concurrent same-session settlement attempts, stale settlement-basis races, or duplicate expiry settlement replay. These need a two-connection disposable PostgreSQL test on the integrated candidate.
- **T+1 distinction:** PR #135 explicitly states its simulator posts variation to virtual cash immediately and does not separately model exchange T+1 receivable/payable timing. Do not present the current cash behavior as an exact exchange cash-settlement timeline.
- **Expiry-day square-off boundary:** the RPC rejects `SIMULATED_SQUARE_OFF` when the settlement date is on/after contract expiry, even if an intraday exit might otherwise be allowed before the expiry cutoff. Confirm intended product policy; do not silently treat this RPC as a complete expiry-day order lifecycle.

## 9. Findings and required follow-up

| ID | Severity | Finding | Required action |
|---|---|---|---|
| F-01 | HIGH | Daily MTM/expiry implementation exists on a separate unmerged line, but is absent from the audited candidate and has no verified exact-head final CI/concurrency evidence here | Reconcile PR #135 into the canonical dependency line; review source/provenance and rerun disposable-PG settlement and same-session race tests on the exact integrated head |
| F-02 | HIGH | Refreshed planner PR #126 has no exact-head CI run and is not wired; older PR #109's helper CI passed, but no atomic per-level settlement exists | Verify PR #126 exact-head unit CI; then implement one atomic batch fill/accounting transaction with per-level fees, margin/cash/position conservation, replay and concurrency tests |
| F-03 | HIGH | Current Futures evidence does not include a dedicated concurrent MARKET margin-contention race | Add same-account competing MARKET BUY/opening orders and cross-engine reservation stress tests; assert no over-reservation |
| F-04 | MEDIUM | Charges and margin fixtures prove internal consistency, not external tariff/SPAN correctness | Add dated, source-backed golden vectors and independent fee/margin review; never label simulation inputs as official margin |
| F-05 | MEDIUM | LIMIT race coverage is present, but multi-instance worker operational rehearsal is not established by this exact-head SQL run | Keep worker disabled; conduct disposable multi-instance lease/heartbeat/session-close rehearsal before any enablement |
| F-06 | HIGH | PR #135 settlement migration changes shared wallet cash/reservation constraints | Reconcile generated deficit semantics with current cross-asset wallet invariants and run account-wide regressions before porting |
| F-07 | HIGH | Expiry/square-off charges are supplied as an RPC argument, not calculated/verified by the settlement SQL | Wire to canonical dated Futures charge resolver and external golden vectors; reject unverified fee inputs |
| F-08 | HIGH | Settlement source hash/domain checks do not prove fetched document authenticity; ingestion worker is missing | Implement trusted source ingestion, verify bytes/hash/session/contract mapping, then keep settlement RPC service-role-only |
| F-09 | HIGH | No two-connection same-session MTM/expiry concurrency or duplicate-expiry replay test is present in PR #135's fixture | Add concurrent disposable PostgreSQL tests for duplicate session/event, stale basis, expiry replay and conservation |
| F-10 | MEDIUM | PR #135 simulator posts variation to cash immediately and does not model T+1 receivable/payable separately | Label the timing as simulator behavior or add explicit settlement receivable/payable states before exchange-timing claims |

## 10. Safety and scope confirmation

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
