# Indian Market F&O LIMIT lifecycle — implementation contract

Status: design checkpoint only. This document does not enable Futures or Options LIMIT orders.

## Verified current boundary

- The Upstox V3 quote-depth parser and derivative LIMIT trigger policy are isolated pure helpers.
- The quote parser accepts FullFeed market depth and FirstLevelWithGreeks first depth, uses feed-level currentTs, checks instrument identity, displayed quantity, integer-paise conversion, freshness and crossed books.
- BUY eligibility is based on executable ask <= limit; SELL eligibility is based on executable bid >= limit.
- Futures MARKET accounting is implemented in execute_paper_futures_market_order.
- paper_futures_orders currently has MARKET/LIMIT and PENDING/FILLED/CANCELLED/REJECTED schema values, but there is no complete Futures LIMIT submit/fill/cancel/expiry RPC lifecycle or dedicated Futures LIMIT worker.
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
- Contract key, exchange, segment, expiry, lot size and tick size still match the verified instrument master.
- Execution price is on tick and satisfies BUY ask <= limit / SELL bid >= limit.
- Quote timestamp is non-future, fresh, and tied to a verified open NSE/BSE session; expiry cutoff is exclusive.
- Caller clock and quote-age values match server time within a small documented tolerance.
- Opening margin reservation is sufficient; closing margin release is proportional and exact on full close.
- The order's remaining quantity and reservation are updated atomically with position, account, realized P&L, charges and fill event.

## Worker requirements

- Separate worker lease keys for Futures LIMIT and Options LIMIT; single-writer lease and bounded batch.
- Scan pending and partially-filled orders with a stable cursor and safe wraparound.
- Group provider requests by user and instrument, use only the user's connected Upstox token, and fail closed on missing/stale/malformed/crossed depth or margin.
- Revalidate the latest quote and session immediately before calling the SQL fill RPC.
- Expire unfilled orders on session close, missing/unverified session data, or contract expiry; release remaining reservations exactly once.
- Worker remains disabled until all SQL, race and rollback tests pass.

## Options LIMIT phase (separate follow-up)

Options remain long-only. BUY-to-open must reserve premium plus supported charges; SELL-to-close must reserve available long quantity. No short-option opening, margin borrowing, or reversal. Use a separate Options lifecycle and preserve the existing long-option ledger and 50-position guard.

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