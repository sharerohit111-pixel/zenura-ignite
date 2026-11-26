# Indian Market — Long Options LIMIT lifecycle design

Status: design-only follow-up to draft PRs #86–#89. This document does not enable Options LIMIT orders. No production migration, merge, deployment, or worker activation is included.

## Scope and safety boundary

- Indian Market Paper Trading only; Crypto and Paper Investing are out of scope.
- Long CE/PE options only. BUY may open or add to a long position. SELL may only close an existing long position.
- No short-option opening, naked selling, margin borrowing, position reversal, or exercise/assignment simulation in this phase.
- Start with NSE options. BSE options remain blocked until the applicable official exchange fee schedule and instrument/session sources are independently verified.
- All prices and cash values are integer paise at application boundaries. Browser input is never authoritative for contract metadata, quote freshness, charges, or available funds.
- Every new feature flag defaults to false. Do not merge, deploy, apply production migrations, or enable workers from CI success alone.

## Existing contracts that must remain intact

- `paper_derivative_positions` is a long-only ledger: `net_quantity > 0`, one row per user/instrument, with fee-inclusive cost basis and average price.
- `execute_paper_long_option_order` is the existing MARKET-only transaction. It owns the current BUY/SELL accounting contract, account-first locking, idempotency, the 50-open-position cap, and fee-inclusive cost basis.
- `paper_derivative_orders` is intentionally MARKET-only and uses terminal receipt states. Do not weaken its order-type or status constraints to retrofit LIMIT semantics.
- Futures LIMIT has its own order/fill ledger and lifecycle. Options LIMIT must remain isolated from Futures tables and worker lease keys.
- `paper_accounts.reserved_cash_paise` and `reserved_margin_paise` are shared account-level invariants. Options reservations must coexist with Futures margin and equity LIMIT reservations without allowing total reservations to exceed cash.

## Proposed isolated data model

Create dedicated tables rather than broadening the existing MARKET receipt table:

### `paper_option_limit_orders`

Required immutable request/contract fields:
- `order_id` (64-character lowercase SHA-256 hex), `user_id`, `idempotency_key`, `request_fingerprint`.
- Exact `instrument_key`, `trading_symbol`, `exchange`, `segment`, `instrument_type` (CE/PE), `expiry`, `strike_price`, `lot_size`, and `tick_size_paise`.
- `side` (BUY/SELL), `quantity`, `filled_quantity`, `remaining_quantity`, `limit_price_paise`, and `average_fill_price_paise`.
- `reserved_cash_paise` for the unfilled BUY remainder; `reserved_close_quantity` for the unfilled SELL remainder.
- `status`: PENDING, PARTIALLY_FILLED, FILLED, CANCELLED, EXPIRED, REJECTED.
- `expires_at`, `simulation_only=true`, timestamps and terminal reservation-release marker.

Constraints and indexes:
- Unique `(user_id,idempotency_key)`; exact order-ID uniqueness.
- Positive quantities; `filled + remaining = original quantity`; quantity must be a whole multiple of the verified lot size.
- BUY orders reserve cash only; SELL orders reserve close quantity only; never both.
- Worker scan index on `(created_at,order_id)` for PENDING/PARTIALLY_FILLED simulation-only orders.
- RLS enabled; authenticated clients may read only their own orders. All writes and worker RPCs are service-role-only.

### `paper_option_limit_fills`

Append-only fill ledger with unique `(order_id,execution_id)` and unique `(order_id,fill_sequence)`. Store exact fill quantity, execution price, gross turnover, incremental charges, realized P&L, bid/ask prices and sizes, quote timestamp, and simulation-only marker. Replays with identical payload are no-ops; altered payload under an existing execution ID is rejected.

### Position close reservation

Add a non-negative `reserved_quantity` to `paper_derivative_positions`, constrained to `reserved_quantity <= net_quantity`. Every SELL LIMIT reserves only currently unreserved long quantity. Existing MARKET SELL must check `net_quantity - reserved_quantity` while holding the same account-first and position lock order, so it cannot consume quantity promised to a pending LIMIT close.

## Atomic RPC lifecycle

All write paths use one lock order: account → LIMIT order → derivative position → fill/idempotency row.

1. **Submit** — verify authenticated owner in gateway, exact official NSE instrument master contract, expiry, lot multiple, tick-aligned limit, verified open exchange session, fresh provider quote, and idempotency fingerprint. Lock account first. For BUY, reserve the maximum limit-price notional plus the order-level estimated charges in `reserved_cash_paise`; for SELL, reserve the close quantity on the long option position. Check total account reservations against cash. Persist a PENDING order atomically.
2. **BUY fill** — require executable ask <= limit and ask displayed quantity >= fill quantity. Debit actual premium and incremental charges; transfer the filled slice from reserved cash to actual cash debit; reduce the order's remaining reservation. Add gross plus buy charges to fee-inclusive option cost basis. Never create a short position.
3. **SELL fill** — require executable bid >= limit and bid displayed quantity >= fill quantity. Require the fill quantity to be within both order and position close reservations. Reduce long quantity and fee-inclusive cost basis proportionally; realize proceeds less released basis and sell charges; decrement reserved close quantity. Never reverse the position.
4. **Partial fill** — allocate reservation with integer arithmetic; the final fill consumes the exact residual paise/quantity. Update order, position, account, and fill ledger in one transaction.
5. **Cancel / expiry** — lock account then order then position. Release only the unfilled BUY cash reservation or unfilled SELL close reservation, exactly once. Terminal orders cannot fill.
6. **Idempotency** — submit retry returns the existing order only when the fingerprint matches. Fill replay is idempotent; changed payload is a hard conflict. Concurrent submit, fill, cancel and expiry races must serialize on the same account/order/position lock sequence.

## Charges and cost-basis contract

- Reuse one shared, tested option-fee calculator for gateway and SQL golden vectors. Do not copy hard-coded rates into a second implementation without parity tests.
- For multiple partial fills, compute cumulative charges on cumulative order turnover and charge each fill only the difference from the previous cumulative total. Brokerage is charged once per logical order, not once per partial fill; the final cumulative total must equal the existing MARKET order fee schedule for the same side and total turnover.
- BUY premium plus BUY charges enter fee-inclusive cost basis. SELL charges reduce realized proceeds. Use integer paise and the established rounding rule; final close consumes the exact remaining cost basis.
- Before NSE-only activation, verify the current official exchange/IPFT/STT/stamp/SEBI/GST treatment and keep the versioned fee schedule explicit. BSE remains disabled until its applicable fee treatment is verified.

## Quote and worker contract

- Reuse the fail-closed Upstox V3 REST executable-depth helper introduced in PR #89: BUY uses best ask, SELL uses best bid; no LTP fallback.
- Require exact instrument identity, positive displayed quantity, safe integer-paise price, fresh non-future snapshot, uncrossed book and tick-aligned execution price.
- The worker uses the account owner's connected Upstox token only, groups requests per user, uses a dedicated `paper_option_limit_orders` lease key and bounded stable cursor, and rechecks the verified session immediately before the fill RPC.
- Expire pending orders at their configured session close, missing/unverified session, or exclusive contract expiry cutoff; release reservations once.
- Worker and submission flags default off. Options worker status must be reported separately from Futures and Equity LIMIT workers.

## UI contract

- Add a separate Options LIMIT ticket and order-history view; do not change the existing Options MARKET ticket semantics.
- BUY/SELL actions must clearly state BUY opens/adds long exposure and SELL only closes available long quantity.
- Show lot size, quantity, limit price, tick size, reserved premium/close quantity, filled/remaining quantity, average fill, charges, and terminal status.
- Cancel only PENDING/PARTIALLY_FILLED orders. Preserve exact retry fingerprint in browser storage; uncertain submissions may only retry the identical request.
- UI remains disabled unless both the server submission flag and worker health flag are explicitly true.

## Mandatory disposable-PostgreSQL and gateway tests

- MARKET-only order schema guard remains intact; separate LIMIT tables have RLS and least-privilege grants.
- BUY reservation includes limit premium and maximum order-level charges; insufficient cash rolls back without order/reservation leakage.
- SELL cannot reserve more than unreserved long quantity; MARKET SELL cannot consume reserved quantity.
- Multiple BUY and SELL partial fills conserve cash, reservation, cost basis and realized P&L; final fill consumes exact remainder.
- Partial fill then cancel/expiry releases only residual reservation, exactly once.
- Exact submit/fill replay is idempotent; altered fingerprint/execution payload is rejected.
- Fill-vs-cancel, fill-vs-fill, duplicate submit and MARKET-SELL-vs-LIMIT-reservation races.
- Wrong instrument, wrong exchange/segment/type/expiry/strike/lot/tick, off-tick price, stale/future/missing/crossed quote, insufficient depth and closed/unverified session all fail closed.
- Per-user Upstox token isolation, worker lease contention, cursor wraparound, missing-token behavior and bounded batch size.
- Existing Options MARKET golden vectors, Futures margin coexistence, 50-position cap and equity/Futures accounting regressions remain green.

## Release gates

No production migration, merge, gateway deployment or flag activation until the isolated lifecycle passes the full disposable PostgreSQL suite, staging end-to-end rehearsal, verified NSE instrument/session snapshots, confirmed Upstox market-data rights, and legal/provider review.
