# NSE Futures Expiry Settlement — Design and Safety Review

**Status:** Design only; not an executable settlement implementation.  
**Date:** 2026-11-23  
**Depends on:** NSE Futures order-engine audit and PR #96.  
**Scope:** NSE Futures Paper Trading only. No live exchange orders.

## 1. Existing implementation audit

The existing system already provides:
- Signed long/short positions in `paper_futures_positions.net_quantity`.
- Average entry price, integer-paise reserved margin, and realized P&L.
- Atomic MARKET execution through `execute_paper_futures_market_order`.
- Atomic LIMIT submit, cancel, expiry and partial-fill transactions.
- Account-first transaction locking and idempotency keys for order submission/fills.
- A verified exchange session calendar.
- Pending LIMIT order cutoff and expiry handling.

The following are explicitly **not** implemented by those features:
- Contract expiry settlement at the official final settlement price.
- Daily exchange-style mark-to-market cash settlement.
- Intraday product square-off at the session close.

The existing `derivative-portfolio.js` MTM is a valuation display. It does not debit/credit cash or release margin. The existing expiry cutoff check only rejects new executions after the contract cutoff; it does not settle an open position.

## 2. Recommended expiry settlement behavior

At the verified NSE contract expiry cutoff, settle each open user position once against a trusted official final settlement price (FSP) for the exact instrument and expiry.

For a signed quantity:
- Long quantity (> 0): `(FSP - average_entry_price) × quantity`.
- Short quantity (< 0): `(average_entry_price - FSP) × abs(quantity)`.

All prices and amounts are integer paise. Use PostgreSQL `numeric` intermediates and reject any result outside bigint bounds before casting.

The expiry settlement transaction should atomically:
1. Lock the user's `paper_accounts` row first.
2. Lock all outstanding LIMIT orders for the same user/instrument in deterministic order.
3. Cancel/expire every PENDING or PARTIALLY_FILLED LIMIT order and release its remaining opening-margin reservation or close-quantity reservation.
4. Lock the Futures position row.
5. Verify the position still matches the exact NSE instrument, expiry, lot size and tick-size snapshot.
6. Calculate realized P&L from the official FSP and signed position quantity.
7. Release the entire remaining position margin reservation.
8. Credit/debit realized P&L to virtual cash and account realized P&L exactly once.
9. Delete or mark the position settled in the same transaction.
10. Insert an immutable settlement record and return a replay-safe receipt.

Do not settle using LTP, best bid/ask, a stale quote, a client-provided price, or an inferred theoretical price. If the official FSP is missing, unverified, ambiguous, or does not match the contract/expiry, leave the position and its margin intact and report settlement as pending.

## 3. Proposed data model (not yet migrated)

A dedicated append-only `paper_futures_settlements` ledger is recommended. Candidate fields:
- `settlement_id` (stable deterministic ID or UUID with unique idempotency constraint)
- `user_id`, `instrument_key`, `trading_symbol`, `exchange='NSE'`, `segment='NSE_FO'`
- `expiry`, `lot_size`, `tick_size_paise`
- `settlement_price_paise`, `settlement_source_reference`, `source_sha256`, `source_published_at`, `verified_at`
- `settled_quantity` (signed), `average_entry_price_paise`
- `realized_pnl_paise`, `released_margin_paise`, `charges_paise`
- `settled_at`, `simulation_only=true`

Required uniqueness:
- One settlement per `(user_id, instrument_key, expiry)`.
- A source snapshot must be immutable and traceable; a changed official correction must use an explicit correction/reversal workflow, never overwrite a posted settlement silently.

The source snapshot should be stored separately from user settlement rows if one verified exchange FSP is shared by all accounts. Keep raw source payload size bounded and persist a SHA-256 digest plus official source URL/reference.

## 4. Accounting and margin coordination gates

This work must be coordinated with the shared Indian-market accounting and Futures margin workstreams before any SQL/RPC implementation.

Required invariants:
- Account cash, account reserved margin, position reserved margin, pending-order margin and settlement ledger reconcile after every transaction.
- `cash_after = cash_before + realized_pnl - approved_settlement_charges`.
- `account_reserved_margin_after = account_reserved_margin_before - expired_open_order_margin - settled_position_margin` (plus any unrelated reservations unchanged).
- No settlement may release a reservation twice.
- No position may be deleted while close-only LIMIT quantity remains reserved; pending orders must be atomically terminalized first.
- Exact replay returns the stored settlement receipt without another cash or margin mutation.
- Same settlement key with a changed FSP/source hash is a hard conflict.
- All writers use one documented lock order: account → order rows (stable order) → position → settlement ledger.
- A concurrent MARKET close, LIMIT fill/cancel/expiry, and settlement race must serialize without duplicate P&L, negative margin, or a position reversal.
- Service-role-only RPC execution; authenticated users receive read-only access to their own settlement history under RLS.

Settlement charges, taxes and any exchange-specific expiry fee must be approved by the charges workstream before they are included. Do not silently assume zero fees or reuse equity charges.

## 5. Separate intraday square-off

Intraday square-off is not contract expiry settlement. It is a separate product rule:
- Only `product='INTRADAY'` positions are candidates.
- Use a verified NSE session calendar and an explicit configured square-off cutoff before session close.
- Use a fresh executable quote and the approved close execution policy.
- Preserve Delivery positions.
- Handle partial execution and insufficient market depth explicitly; never pretend a full close occurred.
- Reserve/coordinate with pending close-only LIMIT orders before attempting square-off.
- If the market is closed, the quote is stale, or the session calendar is unverified, fail closed and surface an unresolved position rather than fabricate a close.

This behavior requires a separately approved product rule and risk/charges review.

## 6. Required test matrix before implementation can be called complete

1. Long position settles above, at and below entry price.
2. Short position settles above, at and below entry price.
3. Multiple lots; paise rounding and bigint overflow boundaries.
4. Zero position: no settlement row and no cash movement.
5. Missing, stale, unverified, wrong-contract and wrong-expiry FSP are rejected.
6. Duplicate delivery and worker restart return the same receipt without duplicate cash/P&L/margin mutation.
7. Same idempotency key with changed FSP or source hash conflicts.
8. Pending opening LIMIT order releases only its unfilled margin remainder.
9. Pending close-only LIMIT order releases only its remaining close quantity before position settlement.
10. Partial-fill LIMIT order preserves prior fills and settles only the remaining open position.
11. Race tests: settlement vs MARKET close, LIMIT fill, LIMIT cancel and LIMIT expiry.
12. Two concurrent settlement workers cannot settle one user/contract twice.
13. RLS prevents one user from reading another user's settlement records.
14. Account/position/order/settlement ledger conservation checks after every scenario.
15. Intraday square-off never closes Delivery positions and never runs on an unverified session.

## 7. Release gates

- Shared accounting and margin owners approve the transaction contract and lock order.
- Official NSE FSP source, licensing/usage rights, correction handling and data provenance are approved.
- Disposable PostgreSQL migration and race tests pass.
- Gateway API/worker integration tests pass.
- Staging rehearsal proves replay safety and ledger reconciliation.
- Explicit feature flag and operational rollback plan are reviewed.
- No production migration, deployment or feature-flag activation is authorized by this design document.

## 8. Non-goals

No Equity, Options, Crypto or Paper Investing changes. No live order routing. No recreation of the existing Futures order, position, margin or LIMIT engine.
