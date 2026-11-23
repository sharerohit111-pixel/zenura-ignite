# NSE Equity Partial-Fill Readiness Audit

**Date:** 2026-11-23  
**Branch:** `feature/indian-equity-lifecycle-audit-2026-11-23`  
**Scope:** NSE cash-equity LIMIT partial fills, DELIVERY and INTRADAY. MARKET remains an immediate full-fill operation.  
**Status:** Design gate only. No partial-fill behavior is enabled by this document.

## Verified current behavior

The existing `paper_orders` schema permits only `PENDING`, `FILLED`, `CANCELLED`, and `REJECTED`. It stores the requested `quantity` and a single `execution_price_paise`, but has no cumulative filled quantity, remaining quantity, or weighted-average execution price.

Both NSE LIMIT fill functions are full-fill functions:

- `execute_paper_limit_fill` accepts order ID, one execution price, quote timestamp/age and caller time. It calculates gross using the entire order quantity, consumes the entire cash/share reservation, updates the position/account once, then sets `status='FILLED'`.
- `execute_paper_intraday_limit_fill` has the same all-at-once quantity/accounting behavior, plus verified exchange-session and quote-time checks.
- Both acquire the user's account row `FOR UPDATE`, then re-read and lock the order `FOR UPDATE`. This is a useful serialization foundation, but the current state machine has no partial state.
- The new immutable fill table supports a unique `(order_id, execution_id)`, but the current LIMIT audit trigger derives one execution ID as `order_id || ':FULL'` and only records a transition from `PENDING` to `FILLED`. It does not record individual partial executions.

Relevant source files:
- `supabase/migrations/20261122120654_paper_trading_core_schema.sql`
- `supabase/migrations/20261123060000_nse_equity_limit_atomic_charges.sql`
- `supabase/migrations/20261123130000_equity_append_only_fill_cash_ledgers.sql`
- `supabase/migrations/20261123140000_equity_order_audit_ledger_trigger.sql`

## Required model changes before implementation

1. **Order state and quantity accounting**
   - Add `PARTIALLY_FILLED` to the cash-equity order status constraint.
   - Add `filled_quantity` (default 0), `remaining_quantity` (or derive it under a strict check as `quantity - filled_quantity`), and `average_fill_price_paise`.
   - Enforce `0 <= filled_quantity <= quantity`; `remaining_quantity = quantity - filled_quantity`; `FILLED` iff remaining quantity is zero; `PARTIALLY_FILLED` iff both filled and remaining quantities are positive.
   - Preserve the original requested quantity and limit price as immutable order intent.

2. **Per-execution fill API and idempotency**
   - Replace the all-quantity LIMIT fill contract with a fill operation accepting a stable, caller-independent execution ID, fill quantity, execution price, quote evidence and time evidence.
   - Validate positive fill quantity and reject any execution that would make cumulative fills exceed the requested quantity.
   - A repeated execution ID with an identical canonical payload must replay the stored result without changing cash, shares, reservations or P&L. Reuse of an execution ID with a different payload must fail.
   - Use the existing unique `(order_id, execution_id)` key as the final duplicate guard; do not synthesize a single `:FULL` ID for every execution.

3. **Reservation accounting**
   - BUY: reserve enough for the unfilled quantity at the limit price plus a conservative, deterministic fee buffer. On each fill, debit actual gross plus the fee allocated to that execution and reduce the order's reserved cash by the corresponding consumed amount. Release any excess reserve on terminal fill or cancellation.
   - SELL: reserve only the still-unfilled share quantity. Each fill reduces both order-reserved quantity and position-reserved quantity by exactly the fill quantity. A cancel releases only the remaining reserved shares.
   - Keep the account invariant `reserved_cash_paise + reserved_margin_paise <= cash_paise` and position invariant `reserved_quantity <= quantity` true after every fill and cancellation.
   - Do not release the entire reservation after the first partial execution.

4. **Accounting and fees**
   - Calculate charges for each execution using the same versioned exchange/product/side fee rules; preserve paise rounding per fill.
   - Store each fill's gross, fee breakdown, cash delta and realized P&L in its immutable fill row.
   - BUY cost basis accumulates actual execution gross plus allocated charges. SELL realized P&L allocates cost basis against the exact filled share quantity; the final close consumes the exact remaining cost basis to avoid rounding residue.
   - Update the order's weighted-average fill price from cumulative execution value / cumulative filled quantity, with an explicitly documented integer rounding rule.
   - Do not infer total-order charges by applying one fee calculation to the average price; minimum fees and rounding can differ across executions.

5. **Concurrency and cancellation**
   - Keep account-then-order lock ordering consistent across fill, cancel, expiry and any worker path.
   - Under the locked order row, revalidate status, remaining quantity, reservation state and execution ID before applying any mutation.
   - Cancellation after partial fills must transition the remaining quantity to `CANCELLED` while retaining historical fills and cumulative filled quantity. A fully filled order cannot be cancelled.
   - A fill racing with cancel must have exactly one serialized outcome: the fill is committed before cancellation (which releases only the residual), or cancellation wins and the fill is rejected. No overfill or double release.

6. **Audit ledger integration**
   - Record one immutable fill row per execution ID.
   - Record unique trade cash ledger events per fill, not one order-wide trade event.
   - Record reservation creation once, incremental reservation consumption/release for each partial fill, and final residual release on cancel/expiry.
   - Event keys must include the stable execution ID and event kind. A duplicate fill replay must not add duplicate ledger rows.
   - Replace the existing trigger's single `:FULL` execution assumption with an explicit, transaction-local fill event contract or write the fill and ledger rows directly inside the fill RPC. Prefer direct writes inside the same transaction for auditable ordering and exact per-fill snapshots.

## Required disposable-PostgreSQL test matrix

- BUY: two or more partial fills, exact per-fill charges, weighted-average price and final remaining cash reservation.
- SELL: multiple partial fills, reserved shares reduced per fill, realized P&L and exact final cost-basis close.
- Partial fill followed by cancellation: filled quantity retained; only residual cash/shares released.
- Duplicate execution ID replay: no duplicate fill, cash movement, reservation movement, position movement or P&L.
- Same execution ID with a different payload: rejected with no mutation.
- Cumulative fill quantity above order quantity: rejected with no mutation.
- Concurrent duplicate execution submissions and concurrent distinct fills: serialized, no overfill.
- Fill-vs-cancel and expiry-vs-fill races for DELIVERY and INTRADAY.
- Cross-product isolation for the same instrument in DELIVERY and INTRADAY.
- Cash-ledger conservation and reservation snapshots reconciled to account state after every operation.
- RLS, tenant isolation, service-role-only RPC grants, pinned empty `search_path`, stale/future/out-of-session quote rejection.

## Safe implementation sequence

1. Introduce a new migration with order-state/quantity columns and constraints; backfill existing full-filled orders as `filled_quantity=quantity`, pending orders as `filled_quantity=0`.
2. Introduce a single, well-specified per-execution fill primitive for DELIVERY and INTRADAY LIMITs, retaining existing validation and lock discipline.
3. Integrate per-fill immutable fill/cash-ledger rows and incremental reservation accounting in the same transaction.
4. Update cancel/expiry paths to release residual reservations only.
5. Add the complete test matrix above and run the full Supabase migration/SQL CI workflow.
6. Keep all migrations draft-only until a separate staging approval. No production migration, deployment or PR merge is part of this work.

## Release gate

Partial fills are **not implemented** by this audit. The current full-fill RPCs and existing audit trigger must not be represented as supporting partial fills. Do not switch the status constraint or expose partial-fill UI until the new RPC, ledger events, reservation math, concurrency tests and accounting reconciliation are all complete.
