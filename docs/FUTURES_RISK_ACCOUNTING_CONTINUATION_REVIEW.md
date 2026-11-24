# Futures Risk & Accounting — Continuation Review Gate

**Review date:** 2026-11-24  
**Scope:** NSE Futures paper trading only.  
**Status:** Review artifact only. This document adds no SQL migration, RPC, worker, feature flag, database write, deployment, or production activation.

## 1. Repository and dependency state observed

- Repository: `sharerohit111-pixel/zenura-ignite`.
- PR #108 is open and Draft. Its head branch is `feature/s-trade-futures-risk-accounting-reconciled-v6-2026-11-23`; its base is `feature/s-trade-nse-futures-worker-lease-2026-11-23`.
- PR #112 is open and Draft. Its head branch is `feature/s-trade-futures-risk-implementation-plan-2026-11-23`; its base is the PR #108 branch.
- GitHub compare reports PR #108's branch is five commits ahead and one commit behind its current base. Do not silently rebase or retarget this dependency chain.
- PR #112's branch is eight commits ahead of its PR #108 base.
- The PR #108 head commit `aa1766724fdd88dda56b6e7f230e00d4d6ccc399` has Paper Trading Supabase SQL smoke test run #1210 completed successfully. All listed jobs passed, including the Futures risk helper tests, complete market-gateway regression, disposable PostgreSQL migrations, existing Futures MARKET accounting, LIMIT reservation/fill race tests, and Futures/Options margin coexistence tests.
- This CI result verifies the checked-in simulation helpers and the existing dependency-chain tests at that commit. It does **not** prove daily variation cash posting, official settlement ingestion, persistent Futures risk ledger, or final expiry settlement exist.

## 2. PR #108 simulation helper review findings

The current `market-gateway/lib/futures-risk-accounting.js` is deterministic arithmetic only. Keep it labelled `simulationOnly`; do not treat it as a production accounting service.

### R1 — Expiry helper uses entry basis, not last settled basis

`settleExpiredPosition` calculates P&L from `averagePricePaise` to the supplied settlement price. After one or more daily variation postings, that would double count already-settled P&L if reused as the final expiry calculation.

**Required correction before any production implementation:** final variation must be calculated from the last accepted official settlement basis (or an explicitly approved opening basis when no daily settlement exists). Preserve trade-close realized P&L, daily variation, and final variation as distinct ledger dimensions.

### R2 — Release helper cannot prove reservation ownership

`releaseSimulatedMargin` accepts an aggregate `usedMarginPaise` and caller-supplied `amountPaise`. It bounds the amount by the aggregate, but it has no reservation identity and cannot prove which position/order reservation is being released.

**Required correction before persistence:** release must reference an owned reservation/event and derive the releasable residual from locked database state. The pure helper may remain a clearly labelled arithmetic demonstration; its comment must not imply it enforces reservation ownership.

### R3 — Maintenance helper is an isolated scenario, not account risk

`evaluateMaintenanceRisk` defines equity as `reservedMarginPaise + unrealizedPnlPaise`. This is an isolated simulation convention, not a canonical account equity or exchange maintenance-margin calculation.

**Required correction before product claims:** name and document the isolated scenario inputs explicitly. Account-level risk must use the cross-derivative cash/collateral and reservation contract reviewed by Chat 2/Chat 7, without double-counting Futures pending reservations or Options margin.

### R4 — Configurable percentage margin is not exchange initial margin

`calculateSimulatedMargin` accepts scenario basis points and calculates a notional percentage with ceiling rounding. It does not calculate NSE SPAN, ELM, additional/special margins, broker risk add-ons, spread offsets, or exchange portfolio-level risk.

**Required correction before any margin label:** retain `CONFIGURABLE_SIMULATION` and `exchangeMarginClaim: false`. Any provider/exchange margin adapter must preserve source, timestamp, contract set, parameter-file version and effective date; missing or stale inputs must fail closed rather than fall back to a percentage.

### R5 — Scenario inputs are not contract/risk-policy validation

The helper accepts positive integer quantities and configured basis-point rates but does not validate official lot-size multiples, instrument identity, expiry state, session, risk-policy version, or position aggregation.

**Required correction:** keep instrument and policy validation in the owning server-side domain layer. Do not let a pure arithmetic helper authorize an order or settlement.

## 3. Canonical accounting invariants to freeze with Chat 2/3/7

1. Account Futures reserved margin equals the sum of open Futures position margin plus pending Futures opening-order reservations, with each reservation represented exactly once.
2. Shared account available margin subtracts cash reservations and all applicable derivative reservations exactly once; Options and Futures must not independently double-subtract a shared balance.
3. Position margin equals opening allocation plus approved additions minus releases and is never negative.
4. A LIMIT opening fill transfers the exact filled share of pending reservation to position margin atomically; the unfilled residual remains attached to the order.
5. Closing fills release only the proportional position reservation, with exact residual release on full close. Pending close-quantity reservation is not opening margin.
6. Daily variation cash delta equals signed open quantity multiplied by the difference between the accepted settlement price and the immediately prior accepted settlement basis.
7. Settlement basis advances in the same transaction as the immutable variation event and cash mutation; failed transactions leave all three unchanged.
8. Final expiry settlement posts only the final basis-to-final-price variation, terminalizes the exact remaining signed quantity, and releases only that position's residual margin.
9. Trade-close realized P&L, daily variation, final variation, charges, and unrealized P&L remain separately identifiable. Unrealized P&L is measured from the latest accepted settlement basis after settlement.
10. For every accounting transaction, account cash delta and reserved-margin delta reconcile to immutable Futures events; no event replay may create a second effect.

## 4. Mandatory test additions before persistent accounting

### Margin and reservation
- Long and short opening reservation; exact cash boundary; one paise below requirement; zero/negative amount; over-release; reservation not owned by the caller; duplicate release; partial fill transfer; full close residual allocation.
- Concurrent reserve/reserve, reserve/release, LIMIT fill/settlement and close/settlement.
- Multiple Futures contracts and concurrent Options reservation in the same account; assert each reservation is counted once.

### Daily MTM
- Long profit, long loss, short profit, short loss, zero variation and multi-day basis roll-forward.
- New position opened on settlement date under each explicitly approved opening-day basis convention.
- Partial close before settlement; settlement uses the exact post-close signed quantity.
- Same event/key/same payload replay; same event/key/changed payload conflict; stale basis version; duplicate settlement source revision; missing/stale/conflicting official price.
- Two concurrent daily settlement workers for the same account/position/date; exactly one cash mutation.
- Failure injection after event insert, cash update and basis update; full transaction rollback.

### Expiry
- Expiry before cutoff; wrong contract/expiry/date; missing final price/provenance; duplicate final settlement; corrected source revision after posting.
- Long/short profit, loss and zero final variation, with and without prior daily settlements.
- Partial close history, pending LIMIT opening reservation, pending close-quantity reservation, exact residual margin release and terminal position audit.
- Race daily MTM versus expiry, fill/cancel versus expiry, and two expiry workers.

### Security and reconciliation
- Append-only event ledger; no authenticated/anon INSERT/UPDATE/DELETE; service-role-only mutation RPCs; RLS and tenant isolation.
- Fixed empty `search_path` for any SECURITY DEFINER function; explicit grants/revokes.
- Cash and margin conservation after every success, replay, conflict and rollback.
- No broker order API call from any simulated liquidation path.

## 5. Official source and effective-date gates

- Use official NSE/NSE Clearing publications for settlement values and rule semantics. A broker quote, LTP, candle close, UI value, or synthetic price is not a settlement source.
- Before writing an importer, download and inspect an official F&O Daily Settlement Prices sample; establish exact columns, contract identity mapping, settlement kind, correction/revision behavior, and report date semantics.
- Preserve source bytes or immutable artifact reference, SHA-256, official report identity, ingestion time, verifier, exchange business date, contract metadata, settlement kind, methodology version and effective date.
- Resolve methodology by contract type and exchange business date. Do not apply a future-effective SOP early. The planned 2026-12-07 transition requires a separately reviewed versioned rule mapping; it is not permission to infer or recompute official prices inside S-TRADE.
- Do not enforce order tick-size alignment on official settlement prices unless the authoritative settlement publication explicitly requires it. Exchange settlement rounding and order-entry tick validation are separate rules.
- For official price parsing, use exact decimal-string conversion to integer paise. Any half-up/tie convention must be verified against the applicable official SOP and sample before being coded.

## 6. Cross-chat approvals required before persistent work

- **Chat 2:** approve separation of trade realized P&L, variation cash settlement, unrealized P&L, charges, and the shared account cash/equity interpretation.
- **Chat 3:** approve exact account/order/position lock sequence and the atomic handoff between pending LIMIT reservation and position margin; no changes to its order/fill RPC contract without its review.
- **Chat 7:** approve shared account reservation aggregation, Options coexistence, migration order, RLS/grants and service-role boundaries.
- **Chat 4:** owns Futures-specific settlement source verification, risk ledger design, MTM/expiry semantics and Futures-only tests.

Until these approvals and the migration-chain reconciliation are complete, keep this work at documentation, pure-domain tests and disposable-CI level. No production/staging migration, hosted database write, deployment, feature activation or broker order routing is authorized.


## 7. PR #110 design cross-review — conflicts to resolve

PR #110 is also open and Draft. It changes only `docs/NSE_FUTURES_DAILY_MTM_EXPIRY_SETTLEMENT_DESIGN.md`; it is design, not a settlement implementation.

### D1 — Lock order is inconsistent across the design chain

- PR #110 says account → position → settlement identity.
- PR #112 ledger design says account → event/idempotency identity → position → settlement basis.
- PR #112 implementation plan separately records the observed PR #89 LIMIT-fill sequence as account → order → execution replay check → position.

These are not interchangeable descriptions. Before any RPC/schema work, Chat 3 and Chat 7 must approve one global, deterministic lock hierarchy that includes account, order (where applicable), idempotency/event identity, position, and settlement-basis rows. Do not select a new sequence in Chat 4 or assume the LIMIT-fill order automatically governs every MARKET/cancel/worker path.

### D2 — Blanket off-tick rejection for official settlement values is not justified

PR #110's trusted-input list says reject off-tick settlement prices. PR #112's implementation plan correctly distinguishes order-entry tick validation from an exchange-computed settlement price and says not to snap an official settlement value to the tradable tick unless the applicable official settlement rule requires it.

**Resolution required:** validate source precision, contract identity, official report value and the settlement methodology's own rounding rule. Do not reject or alter a published settlement price solely because it is not a valid order-entry tick. Confirm the exact applicable NSE/NCL rule for the supported contract type before adding a tick constraint.

### D3 — Arithmetic type should be BigInt, not Number

PR #110 asks for numeric intermediate arithmetic and bigint bounds. PR #108's helper and PR #112 plan use checked BigInt intermediates. The implementation contract should consistently use BigInt for multiplication/subtraction and enforce the target database integer range before writing; JavaScript Number must not be the money arithmetic intermediate.

### D4 — Opening-day basis is intentionally unresolved

PR #110 says use weighted-average execution price for a position opened after the previous settlement, but also says the opening-day variation must follow an approved exchange convention. PR #112 correctly keeps this as an explicit approval gate.

**Resolution required:** do not silently assume the weighted-average trade price is the daily settlement basis for every new/partially increased position. Approve and test the precise day-one basis treatment for same-day open, add-on, partial close, reversal and position netting before enabling any cash posting.

### D5 — Pending order expiry is not contract expiry settlement

PR #110 explicitly distinguishes the existing LIMIT order expiry worker (pending order reservation release) from terminal settlement of an open Futures position. Preserve this distinction in UI, worker names, metrics, event types and audit logs. A pending-order expiry success must never be reported as Futures contract settlement.

## 8. Official NSE source review performed on 2026-11-24

The official NSE All Reports – Derivatives page currently lists, separately:
- F&O – SPAN Risk Parameter Files (Begin of Day, multiple intra-day snapshots and End of Day);
- F&O – Daily Settlement Prices;
- F&O – UDiFF Common Bhavcopy Final;
- NSE F&O exclusive contract files and related contract/position reports.

Source: https://betanseapi.nseindia.com/all-reports-derivatives

This supports a source-adapter design that treats margin parameter snapshots, daily settlement prices, final bhavcopy and contract master as distinct source artifacts. It does not by itself prove the exact CSV column schema, final-settlement flag semantics, correction process, or that one file contains every field needed for settlement. The official sample file still must be downloaded and schema-inspected before importer code.

NSE's published CAS 2.0 FAQ identifies the revised final settlement price method for expiring equity derivatives:
- Index derivatives: underlying index value based on constituent securities' VWAP during the last 30 minutes of the Continuous Trading Session in the equity cash segment.
- Stock derivatives: underlying stock VWAP during the last 30 minutes of CTS in the cash segment across all stock exchanges.

Source: https://nsearchives.nseindia.com/web/mediaattachment/2026-11/FAQs_for_CM_and_FO_FOR_CAS_2.0_20261109152618.pdf

The official NSE page identifies the CAS 2.0 changes as applicable from 2026-12-07:
https://betanseapi.nseindia.com/static/trade/continuous-markets-FAQs

Treat 2026-12-07 as a versioned effective-date boundary for the applicable revised rule, not as permission to apply it early. The importer should consume the clearing corporation's published settlement result; S-TRADE must not reconstruct the final price from broker quotes or constituent data.

The current official report page also lists multiple SPAN parameter snapshots. A single hard-coded margin percentage cannot be represented as the NSE initial margin calculation. Any future margin-source adapter needs an explicit contract-set snapshot, source file hash, parameter-file time/version, effective trading date and a fail-closed policy for stale/missing inputs.

## 9. Next safe work gate

1. Ask Chat 3/7 to resolve D1 and approve the exact cross-path lock hierarchy.
2. Ask Chat 2/7 to approve shared account margin aggregation and opening-day basis accounting treatment with Chat 3.
3. Obtain and inspect an official NSE F&O Daily Settlement Prices sample plus the applicable current contract-master and SPAN files; record actual headers and row identity without guessing.
4. Reconcile the official sample's daily/final settlement semantics and correction/revision behavior against the applicable effective-dated NSE/NCL circular/SOP.
5. Only then draft a Futures-only schema/RPC proposal and executable disposable-PostgreSQL test plan. No hosted migration, staging/production write, deployment or feature activation is authorized.


## 10. Additional official CAS 2.0 final-settlement clarification (verified 2026-11-24)

The NSE FAQ titled "Closing Auction Session (CAS) 2.0 in the Equity segment and changes in Equity Derivatives Segment", Version 1, updated 2026-11-06, explicitly states:
- The changes are applicable from 2026-12-07; the special changes for unexecuted CTS limit and disclosed-quantity orders are effective 2027-02-08.
- For expiring index derivatives, final settlement price is based on the underlying index value calculated using constituent securities' VWAP during the last 30 minutes of the Continuous Trading Session (CTS) in the equity cash segment.
- For expiring stock derivatives, the Clearing Corporations determine final settlement price based on underlying-stock VWAP during the last 30 minutes of CTS in the cash segment across all Stock Exchanges.
- The FAQ separately says the daily closing price of derivatives contracts continues under the existing methodology and defines its last half-hour calculation period as 15:15–15:45 under the revised timings. Do not confuse that daily derivative close with the final expiry settlement price.
- It also states that clearing-corporation communications govern cross-exchange closing-price differences for settlement calculations.

Official source: https://nsearchives.nseindia.com/web/mediaattachment/2026-11/FAQs_for_CM_and_FO_FOR_CAS_2.0_20261109152618.pdf (see questions 2, 42–43, 72–73 and 105).

**Implementation consequence:** store settlement kind and methodology version explicitly. Daily settlement-price ingestion and final-expiry settlement ingestion must not share an inferred price rule. For final expiry, consume the official Clearing Corporation settlement result for the exact contract and expiry date; do not calculate it from a daily closing price, a single-exchange cash close, LTP, or broker feed. Apply the new effective-dated methodology only from 2026-12-07. The FAQ is a summary; retain the detailed circular/SOP and Clearing Corporation publication as the implementation authority before coding.

## 11. CI observation for this documentation-only update

Commit `ac8bba2dcda43c15aca7d559afacab3e006feedd` has no pull-request workflow run returned by the commit workflow-runs endpoint at the time of this check. This is not a passing CI result. The prior PR #108 commit's successful disposable SQL smoke run remains scoped only to that earlier commit and its code/tests.
