# NSE Equity — Atomic Fill and Cash Ledger Integration Design

Status: source-reviewed implementation contract; not an active migration and not evidence of passing database tests.

## Scope

This design applies only to NSE/BSE cash-equity paper accounting on the Equity branch. It does not change Futures, Options, Crypto, production schema, or active migration history.

The source branch already contains:
- `execute_paper_market_order(uuid,text,uuid,text,text,text,text,text,text,integer,bigint,bigint,bigint)` in the MARKET charges migration.
- The final replacement implementation of that MARKET RPC in `20261123060000_nse_equity_limit_atomic_charges.sql`.
- `execute_paper_limit_fill(text,bigint,bigint,bigint,bigint)`.
- `execute_paper_intraday_limit_fill(text,bigint,bigint,bigint,bigint)`.
- Append-only `paper_equity_fills` and `paper_equity_cash_ledger` tables in `20261123130000_equity_append_only_fill_cash_ledgers.sql`.

The ledger migration explicitly leaves the settlement RPCs unwired. This document defines the missing integration; it does not modify those RPCs yet.

## Verified current contracts

### Parent/order and position model
- `paper_orders.order_id` is the primary key; each order has non-null `user_id`.
- `paper_accounts.user_id` is the account primary key.
- `paper_equity_positions` is keyed by `(user_id, product, instrument_key)`.
- Existing settlement functions use integer paise and perform account → order → position locking for LIMIT fills. The MARKET path locks account and then the position; it creates its order row in the same function transaction.
- MARKET fills settle the complete requested quantity immediately.
- Delivery LIMIT and Intraday LIMIT fill functions currently settle the complete order quantity; they are not partial-fill APIs.

### Fill schema
`paper_equity_fills` has a generated UUID `fill_id`, `execution_id`, order/instrument/side/product/quantity, execution price, gross, charges, cash delta, realized P&L, quote timestamp, and timestamps. It currently enforces `UNIQUE(order_id, execution_id)`.

### Cash ledger schema
`paper_equity_cash_ledger` has a per-user unique `event_key`, optional order/fill references, event type, cash delta, reserved-cash delta, post-event cash/reserved-cash snapshots, and metadata. The event-shape check requires:
- TRADE_DEBIT: negative cash delta and non-null fill.
- TRADE_CREDIT: positive cash delta and non-null fill.
- RESERVATION_CREATE / RESERVATION_RELEASE / RESERVATION_CONSUME: zero cash delta and null fill.
- ADJUSTMENT: separately governed.

## Required atomic settlement behavior

All mutations below must occur inside the existing settlement RPC transaction. Do not use an AFTER trigger on `paper_orders` as a substitute: that would hide accounting side effects from the RPC contract and makes reservation-event sequencing harder to reason about.

For each successful MARKET, Delivery LIMIT, and Intraday LIMIT settlement:

1. Preserve the existing validation, idempotency, quote/session checks, fee calculations, lock order, position math, and order status behavior.
2. Compute the exact existing fill result from the already-calculated execution values; do not independently recalculate charges or P&L in a second helper.
3. Insert exactly one `paper_equity_fills` row for the current full-fill RPC contract, with values copied from the final settlement variables and the final order/account ownership.
4. Update `paper_accounts`, `paper_equity_positions`, and `paper_orders` exactly as the existing function does.
5. Insert matching cash-ledger events using the final account snapshot:
   - MARKET BUY: TRADE_DEBIT.
   - MARKET SELL: TRADE_CREDIT.
   - LIMIT BUY: TRADE_DEBIT plus a distinct RESERVATION_CONSUME event for the order's reserved cash release.
   - LIMIT SELL: TRADE_CREDIT; share reservation release remains represented by the position/order state, not by the cash ledger.
6. Ensure each ledger `event_key` is stable and unique per user, e.g. fill-scoped trade key and order-scoped reservation-consume key. A retry must not create a second fill or duplicate ledger event.
7. Return the inserted fill identifier and the existing response fields without breaking current API consumers.

The fill `execution_id` must be deterministic for the current one-fill-per-order RPC contract (for example, a namespaced order identifier). Do not introduce a random retry-varying execution ID. If partial Equity fills are later introduced, extend the worker/RPC input contract with a stable execution ID and fill sequence before enabling them; do not overload the current full-fill behavior.

## Important cash-ledger sequencing detail

For LIMIT BUY, the cash balance decreases by the actual fill debit while the reserved-cash balance decreases by the full order reservation. These are distinct accounting facts. Record both:
- TRADE_DEBIT with the fill reference and actual negative cash delta.
- RESERVATION_CONSUME with no fill reference and negative reserved-cash delta.

Both snapshots must reflect the final account state after settlement. Event keys must differ and be stable. This uses the existing event-shape constraint without weakening it.

For MARKET fills, no reservation is consumed by these RPCs, so the ledger trade event has a zero reserved-cash delta.

## Idempotency and concurrency

- MARKET retry with the same user/idempotency key/fingerprint returns the existing order result and does not add another fill or ledger row.
- Reuse of an idempotency key with a changed fingerprint remains a conflict.
- LIMIT worker retry after the order is FILLED returns the existing filled result and does not append another fill or ledger event.
- Two concurrent LIMIT workers must still serialize on the account and order locks; only the winning transaction may append the fill.
- Any exception after the first accounting insert must roll back account, position, order, fill, and ledger changes together.

## Migration implementation requirements

- Modify the existing settlement function definitions in one new additive migration; do not edit already-applied migration files.
- Keep all existing function signatures stable unless a separately reviewed API change is approved.
- Keep `SECURITY DEFINER`, empty/fixed `search_path`, and explicit revoke/grant ACLs consistent with the current functions.
- Keep append-only triggers and service-role direct DML restrictions.
- Add a tenant-safe composite FK from fills to orders and from ledger rows to their order/fill parents in the already separate integrity draft, after verifying prerequisites on the final integration branch.
- No trigger-based ledger writes, no direct client writes, no service-role UPDATE/DELETE on immutable audit rows.
- Do not touch Futures, Options, or Crypto files.

## Regression tests required before release

1. MARKET BUY and SELL each create one fill and the matching debit/credit ledger row.
2. Delivery LIMIT BUY creates one fill, one TRADE_DEBIT, and one RESERVATION_CONSUME event; cash and reserved-cash snapshots match the final account.
3. Delivery LIMIT SELL creates one fill and one TRADE_CREDIT; share reservation is released exactly once.
4. Intraday LIMIT BUY/SELL behave equivalently while retaining verified session restrictions.
5. Fill values equal the final order values for quantity, execution price, gross, charges, charge breakdown, cash delta, and realized P&L.
6. Exact MARKET idempotent replay produces no additional fill or ledger event.
7. Exact LIMIT worker replay produces no additional fill or ledger event.
8. Changed MARKET fingerprint remains rejected.
9. Concurrent duplicate LIMIT fill workers result in exactly one fill and the expected final order/account/position state.
10. Force an error after fill insertion and assert complete transaction rollback.
11. Cross-user order/fill references fail after the tenant-safe composite FKs are integrated.
12. UPDATE/DELETE attempts on fills and ledger fail, including service_role.
13. Existing reservation and account invariants remain true after BUY/SELL and partial position reductions.
14. Run migration replay and pgTAP/SQL integration tests from the known production migration-history boundary in disposable PostgreSQL.
15. Compare Crypto schema objects, migrations, and RPC ACLs before/after; they must be unchanged.

## Known scope gaps to keep explicit

- Current Equity LIMIT fill RPCs are full-fill, not partial-fill. Partial-fill accounting must not be claimed as implemented.
- Cancellation/rejection reservation-release ledger events are not covered by the three settlement functions; integrate them in the corresponding cancel/reject RPCs as a separate reviewed step.
- No disposable PostgreSQL integration test has been run for this design yet.
- No production DDL, migration, grants, or policies were changed.
