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
