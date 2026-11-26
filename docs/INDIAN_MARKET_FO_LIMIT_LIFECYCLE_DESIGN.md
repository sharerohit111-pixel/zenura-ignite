# Indian Market F&O LIMIT lifecycle — implementation contract

Status: implementation in draft PRs #87–#89. This document does not enable Futures or Options LIMIT orders. No production migration, merge, deployment or worker activation has occurred.

- PR #87 — Futures LIMIT ledger schema foundation.
- PR #88 — atomic submit, opening-margin/close-quantity reservation, cancellation and expiry.
- PR #89 — atomic partial/full fill settlement, executable quote snapshot validation and opt-in worker module.

## Verified current boundary

- The Upstox V3 WebSocket quote-depth parser and REST Full Market Quotes V3 parser are isolated pure helpers.
- The REST parser uses the snapshot timestamp and top-of-book depth.buy[0]/depth.sell[0], checks exact instrument identity, displayed quantity, integer-paise conversion, freshness and crossed books; no LTP fallback is allowed.
- BUY eligibility is based on executable ask <= limit; SELL eligibility is based on executable bid >= limit.
- The SQL fill RPC receives and rechecks the exact bid/ask prices and displayed quantities used by the worker, and persists them in the fill ledger.
- Futures MARKET accounting is implemented in execute_paper_futures_market_order.
- The Futures LIMIT ledger adds filled/remaining quantities, average fill price, pending opening-margin and close-quantity reservations, expiry, executable bid/ask snapshot fields, and an append-only execution fill table.
- Opening margin reservation requires a fresh trusted provider-margin timestamp; SQL checks the margin snapshot age at submit time. Close-only orders do not request or reserve opening margin.
- Atomic service-role RPCs now cover submit, partial/full fill, cancel and expiry; account -> order -> position locking, execution-idempotency and reservation release are tested on disposable PostgreSQL.
- The authenticated Futures LIMIT submit/cancel API and isolated NSE Futures LIMIT ticket/order-history UI are wired behind PAPER_FUTURES_LIMIT_ENABLED=true; the flag defaults off. The UI also requires the worker health flag before enabling submission. Submission requires a verified open session and a fresh provider margin snapshot for opening exposure.
- The dedicated Futures LIMIT worker module is wired behind PAPER_FUTURES_LIMIT_WORKER_ENABLED=true; the flag defaults off. The worker currently supports NSE Futures only; BSE Futures remain blocked until their charge schedule is verified.
- Long Options remain MARKET-only; derivative_limit_schema_guard.sql protects the Options order schema from premature LIMIT enablement.
- F&O LIMIT must remain disabled until the database lifecycle and worker are complete.

## Required state model

A Futures LIMIT order needs explicit original, filled and remaining quantities. Required states:

- PENDING: no fill has been recorded.
- PARTIALLY_FILLED: filled quantity is positive and remaining quantity is positive.
- FILLED: remaining quantity is zero.
- CANCELLED / EXPIRED: terminal; all unfilled reservation has been released exactly once.
- REJECTED: terminal; no active reservation remains.

A fill is an append-only/idempotent execution event with a unique fill key. Replaying the same fill must not change cash, margin, quantity, cost basis or P&L twice.

## Reservation and accounting invariants

1. Use integer paise and safe-integer bounds at every gateway boundary; PostgreSQL arithmetic must reject values outside supported bigint/numeric bounds.
2. Reserve margin for the unfilled opening quantity at submit time using a trusted, instrument-matched, fresh provider margin response. Never accept margin from the browser.
3. For close-only orders, reserve the closeable position quantity so concurrent orders cannot close the same exposure twice. A close-only order must not reverse a position.
4. Account reserved margin must always equal open-position margin plus unfilled opening-order margin. Moving a filled slice from order reservation to position margin must conserve the total unless an explicitly revalidated provider margin adjustment is applied.
5. Allocate partial-fill reservation proportionally using integer arithmetic; allocate the exact remaining paise on the final fill. Cancellation releases only the residual reservation.
6. A failed fill/cancel transaction must roll back the order, account, position and fill-event changes together.
7. Existing Futures MARKET orders and long Options BUY/SELL accounting must continue to work with pending LIMIT reservations.

## Lock order and race safety

All write RPCs must follow one lock order:

1. paper_accounts row for the user (serializes shared cash and margin),
2. paper_futures_orders row (serializes fills/cancel for this order),
3. paper_futures_positions row (serializes exposure and close reservations),
4. fill-event row/unique key as required by the idempotency design.

Submit must also lock the account before checking or creating the idempotency record. Fill, cancel and expiry must use the same order. Do not introduce a path that locks position then account.

## Server-side fill validation

The SQL fill RPC must independently validate all facts; worker eligibility alone is not authority:

- Order is owned by the account, simulation-only, pending/partially-filled and not terminal.
- Fill quantity is positive and no greater than remaining quantity or available close reservation.
- The worker matches contract key, exchange, segment, expiry, lot size and tick size against the verified instrument master; SQL independently checks the stored order/position contract snapshot and tick alignment.
- Execution price is on tick and satisfies BUY ask <= limit / SELL bid >= limit.
- Quote timestamp is non-future and fresh; SQL validates the executable side, exact displayed depth quantity, exclusive expiry cutoff, and a verified open NSE/BSE session whose official-source reference and SHA-256 are present.
- Caller clock and quote-age values match server time within a small documented tolerance.
- Opening margin reservation is sufficient; closing margin release is proportional and exact on full close.
- The order's remaining quantity and reservation are updated atomically with position, account, realized P&L, charges and fill event.

## Worker requirements

- Separate Futures LIMIT lease key, single-writer lease and bounded batch are implemented; Options LIMIT remains a separate future phase.
- Scan pending and partially-filled orders with a stable cursor and safe wraparound.
- Group provider requests by user, use only the user's connected Upstox token, and fail closed on missing/stale/malformed/crossed depth.
- Revalidate the latest quote and verified session immediately before calling the SQL fill RPC.
- Expire unfilled orders on session close, missing/unverified session data, or contract expiry; release remaining reservations exactly once.
- Submit and worker flags both remain disabled by default and have no production activation. Neither opt-in flag may be enabled until staging and legal/provider gates are satisfied.

## Options LIMIT phase (separate follow-up)

Options remain long-only. BUY-to-open must reserve premium plus supported charges; SELL-to-close must reserve available long quantity. No short-option opening, margin borrowing, or reversal. Use a separate Options lifecycle and preserve the existing long-option ledger and 50-position guard.

## Implemented test coverage so far

- Schema migration and client-role privilege boundaries.
- Existing Futures MARKET compatibility with new LIMIT reservations.
- Opening-margin and close-quantity reservation, fresh margin snapshot validation, idempotent submit (including replay after expiry), cancel and expiry.
- Partial/full opening fills, weighted average price, charges, realized P&L and margin conservation.
- Partial/full close fills, proportional margin release, no position reversal and final position deletion.
- Exact execution replay and altered-payload replay rejection.
- Fill-first/cancel-first races and concurrent duplicate provider execution.
- REST quote parsing for best bid/ask, depth size, stale/future timestamps, crossed books and no LTP fallback.
- Worker unit coverage for NSE contract matching, cumulative per-order charges, missing-session expiry and exact top-of-book fill quantity.

## Mandatory disposable-PostgreSQL tests before enabling

- Duplicate submit idempotency and changed-fingerprint rejection.
- Insufficient margin/cash rollback with no order or reservation leak.
- Multiple partial fills with exact reservation conservation and cost-basis/P&L reconciliation.
- Final partial fill consumes the exact reservation remainder.
- Partial fill then cancel releases only the residual reservation.
- Duplicate fill replay is idempotent.
- Concurrent fill-vs-cancel, fill-vs-fill and duplicate-submit races.
- Close reservation prevents two orders from closing the same Futures quantity.
- Close-only order cannot reverse a position.
- Stale, future, caller-age-mismatched, missing-side and crossed-book quotes fail closed.
- Off-tick price, expired contract, closed/unverified session and session-boundary cases.
- Authenticated/anon cannot execute privileged RPCs; service-role grants and tenant isolation are verified.

## Release boundary

Do not merge, apply production migrations, deploy the gateway, or enable any worker based only on passing unit tests. Require the full disposable PostgreSQL suite, explicit staging rehearsal, verified official NSE/BSE instrument/session snapshots, confirmed Upstox market-data rights and legal review.