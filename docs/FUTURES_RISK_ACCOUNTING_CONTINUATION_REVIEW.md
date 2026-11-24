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
