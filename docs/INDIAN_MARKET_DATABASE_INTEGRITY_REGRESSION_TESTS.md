# Indian-market tenant/fill integrity regression matrix

Status: design/test contract only. Run only after integration in disposable PostgreSQL.

## Preconditions
- Start from the exact production migration-history boundary in a clean disposable database.
- Apply the canonical merged migration sequence: Equity ledger, Futures LIMIT fill,
  Options LIMIT fill, then the tenant/fill integrity migration.
- Seed two distinct auth users (A and B), each with an independent paper account.
- Seed valid Equity, Futures, and Options LIMIT orders for user A using existing RPCs.
- Run as postgres, service_role, authenticated A, authenticated B, and anon.

## Required assertions

1. Equity fill with user A and user B order is rejected by
   paper_equity_fills_user_order_fk.
2. Equity cash-ledger row with user A and user B order is rejected by
   paper_equity_cash_ledger_user_order_fk.
3. Equity cash-ledger row with user A and user B fill is rejected by
   paper_equity_cash_ledger_user_fill_fk.
4. Futures fill with user A and user B Futures order is rejected by
   paper_futures_fills_user_order_fk.
5. Valid same-tenant fills and ledger rows still insert through existing atomic RPCs.
6. UPDATE and DELETE on all four audit tables fail with SQLSTATE 55000, including
   attempts by service_role.
7. service_role retains SELECT/INSERT; anon and authenticated have no direct table
   privileges on the four audit tables.
8. Options fill RLS ownership continues to resolve through its parent order; user B
   cannot read user A fills.
9. Exact execution replay remains a no-op; changed payload with same execution ID
   remains a conflict.
10. Partial/full fills preserve quantity, cash/margin reservation, realized P&L,
    and terminal-order invariants.
11. Existing order/worker RPC signatures, SECURITY DEFINER status, fixed search_path,
    and execute ACLs are unchanged.
12. Migration fails closed if any prerequisite table is absent.
13. Crypto schema inventory, migration checksums, RPC ACLs, and Crypto files are
    byte-for-byte unchanged.

## Performance checks
- Verify the new composite unique indexes support tenant FK checks.
- Preserve order/execution and order/fill-sequence unique indexes.
- Run EXPLAIN (ANALYZE, BUFFERS) for user fill history and worker fill lookups.
- Do not remove existing indexes in this migration.

## Rollback
Use the paired draft rollback only in disposable environments. Production recovery
requires a separately reviewed compensating migration, never editing migration history.
Verify grants and triggers against the pre-migration snapshot.


## Equity settlement-specific assertions

For the three current full-fill Equity settlement RPCs (MARKET, Delivery LIMIT, Intraday LIMIT), additionally assert:

- Exactly one deterministic order-scoped fill row per successful full-fill order.
- Fill row values exactly match the final order settlement variables (quantity, price, gross, charges, fee breakdown, cash delta, realized P&L, quote timestamp).
- MARKET BUY/SELL append one TRADE_DEBIT/TRADE_CREDIT row respectively.
- LIMIT BUY appends one TRADE_DEBIT and one RESERVATION_CONSUME event with stable distinct event keys and final cash/reserved-cash snapshots.
- LIMIT SELL appends one TRADE_CREDIT; its reserved-share release matches the order and position state.
- Exact retries append no additional rows; changed idempotency fingerprints remain rejected.
- Concurrent duplicate LIMIT workers create only one fill and one set of ledger events.
- An exception after the fill insert rolls back fill, ledger, order, account, and position changes together.
- Do not assert partial Equity fill behavior: current Equity LIMIT fill RPCs settle the full remaining order quantity and have no caller-supplied execution ID/fill-sequence contract.
- Cancellation/rejection reservation release requires separate RPC coverage and must not be marked complete by these fill tests.


## Draft implementation static checks (not database test results)

The current draft integration SQL must pass all existing Equity assertions plus:
- Each of the three RPC definitions retains its exact existing signature and SECURITY DEFINER + empty/fixed search_path.
- MARKET full fill inserts one fill and one trade event.
- Delivery and Intraday LIMIT full fill insert one fill and one trade event; BUY additionally inserts one reservation-consume event, SELL does not.
- The deterministic execution ID is `equity-order:<order_id>`; it is stable across retries and fits the current 128-character constraint.
- Returned `fill_id` is present for new settlements and is looked up on exact replay when an existing fill row is available.
- All fill and ledger inserts occur within the existing function transaction, after settlement state is calculated, so injected failures must roll back all changes.
- Validate final account snapshots and ledger deltas against actual database state; do not accept static text inspection as proof.

Status: source-level static checks only. SQL parse/compile, disposable DB, pgTAP, concurrency, and forced rollback tests are still NOT RUN.


## Added executable Equity regression coverage (2026-11-23)

The disposable PostgreSQL 17 workflow now runs the following assertions after applying the draft Equity RPC integration:

- MARKET BUY/SELL fill rows and trade-ledger entries reconcile to the final cash balance; exact MARKET BUY replay creates no duplicate rows.
- Delivery LIMIT BUY creates one fill, TRADE_DEBIT and RESERVATION_CONSUME with matching deltas and final snapshots; replay creates no duplicates.
- Delivery LIMIT SELL creates one fill and one TRADE_CREDIT, with no cash reservation-consume event.
- Intraday LIMIT BUY and SELL reconcile their fill/ledger rows, cash deltas and final cash snapshots; replay creates no duplicates.
- An injected failure at the first ledger insert after a Delivery LIMIT fill insert aborts the whole RPC statement. The test asserts the order remains pending, no fill/ledger row remains, and account/position state is unchanged.
- Existing Intraday LIMIT fill-vs-cancel and cancel-vs-fill race shell test is included in the PostgreSQL 17 workflow. Its cleanup retains the filled parent order so immutable fill/ledger foreign keys remain valid.

These tests are committed but have not yet been observed passing in GitHub Actions. The tenant-composite-FK draft still requires a canonical combined Futures/Options/Equity migration chain before its cross-tenant integration tests can safely run. No production migration or production database write was performed.


## PostgreSQL 17 execution result (2026-11-23)

The disposable CI run [45158171206](https://github.com/sharerohit111-pixel/zenura-ignite/actions/runs/45158171206) completed successfully on commit `5dbf8eecbf24c72a5d436c378e86c269f7f8fdc3` using PostgreSQL 17.12.

All configured checks passed: repository migrations, Equity integration draft compilation/application, append-only schema checks, MARKET fee settlement, Delivery LIMIT BUY/SELL ledger and replay assertions, injected atomic rollback, Intraday LIMIT reservation/fill assertions, and concurrent fill/cancel race tests.

This result applies only to the listed Equity-focused disposable test lane. Tenant-composite-FK tests and the integrated Futures/Options/Equity migration sequence remain pending; no production migration was applied.
