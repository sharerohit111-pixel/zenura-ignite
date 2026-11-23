# Futures Risk & Accounting Audit

**Scope:** NSE Futures paper-trading risk/accounting only. This document is a code audit and simulation design record; it does not authorize production migrations, deployments, feature activation, or live trading.

## Repository baseline

- Repository: `sharerohit111-pixel/zenura-ignite`
- Audit base: `feature/s-trade-nse-futures-worker-lease-2026-11-23`
- Work branch: `feature/s-trade-futures-risk-accounting-2026-11-23`
- Existing Futures chain: PR #87 schema, PR #88 submit/release, PR #89 atomic partial fills, PR #93 dedicated worker lease. All were open Draft PRs at audit time; do not imply they are merged or deployed.
- Existing main Futures MARKET transaction: `execute_paper_futures_market_order` in `20261122120722_futures_market_order_transaction.sql`.
- Existing account and position money is stored in integer paise.

## Verified existing behavior

1. MARKET execution accepts a trusted server-provided margin amount, validates a fresh provider quote and expiry cutoff, and serializes writes with account → idempotency/order → position locks.
2. Positions use signed net quantity; opposite-side fills close existing exposure first and can reverse the position only when a positive margin amount is supplied for the new exposure.
3. Account-level `reserved_margin_paise` is updated atomically with position-level `reserved_margin_paise`; close margin release is proportional with exact residual release on full close.
4. MARKET execution debits charges and credits/debits realized P&L to virtual cash, and stores a FILLED order receipt. The disposable SQL test reconciles account realized P&L to order receipts and account margin to open-position margin.
5. LIMIT work adds separate pending opening-margin and close-quantity reservations, an immutable fill table, atomic submit/cancel/expiry and partial-fill RPCs. Partial opening fills transfer reservation from order to position; close fills release position margin.
6. LIMIT submit/fill use the same account → order → position lock sequence, idempotent execution identity, verified session and executable quote-side checks. The dedicated worker lease remains a separate concurrency primitive, not an accounting lock.
7. Portfolio MTM currently computes signed quantity × (current quote − average entry price). It withholds aggregate unrealized P&L/equity when any open-position quote is stale or unavailable.

## Gaps / not established by the inspected implementation

- Existing `reserved_margin_paise` is a persisted provider-supplied reservation amount; it is not a separately versioned simulation initial-margin model and must not be labelled as NSE/SPAN/official margin.
- The inspected portfolio endpoint labels margin status as `entry_estimate`; no complete available/used/maintenance margin risk snapshot was found.
- No durable prior-settlement price/basis and daily variation-margin posting lifecycle was verified.
- No complete Futures expiry settlement workflow with an explicit authoritative settlement-price source, settlement ledger, idempotent close and margin release was verified.
- No automatic liquidation simulation workflow was verified. A maintenance breach signal must remain distinct from execution; no automatic close should be implied.
- Position rollover/next-contract transfer is not verified. Futures contracts must not be silently carried into a different expiry/instrument key.
- A provider margin preview is a read-only preview and is not itself a durable reservation or exchange guarantee.

## Simulation design boundary

- Keep provider/exchange margin snapshots explicitly labelled with their provider/source timestamp and contract context.
- Keep configurable scenario initial/maintenance rates in a separate model named `CONFIGURABLE_SIMULATION`; never silently fall back from missing exchange/provider data to a guessed rate.
- Use integer paise and signed integer quantities for all accounting. Reject unsafe integer arithmetic.
- Mark-to-market is signed quantity × (mark − basis). Daily variation is signed quantity × (today settlement − prior settlement), then the settlement basis advances only after an idempotent settlement posting.
- Maintenance breach is a risk state, not an exchange liquidation notice. A liquidation simulation requires a separately authorized simulation policy and must not submit a real broker order.
- Expiry settlement requires an explicit settlement price and provenance. Do not derive it from LTP, chart close, or a payoff helper.
- Rollover is two distinct simulated legs (close old contract, open new contract), each with its own contract validation, margin requirement, charges and idempotency identity.

## Shared-component boundary

Do not modify common account schema, generic worker leases, Equity/Options code, common market gateway routing, shared auth/RLS, or PR #93 lease functions without cross-chat coordination. Follow-up persistent accounting changes should be limited to Futures-specific migrations/RPCs/tests and reviewed against the existing global account lock order.
