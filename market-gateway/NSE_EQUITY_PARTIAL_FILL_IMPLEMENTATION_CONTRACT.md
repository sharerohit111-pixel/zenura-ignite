# NSE Equity Partial-Fill Implementation Contract

**Status:** Design proposal only — not approved for runtime implementation  
**Scope:** NSE cash-equity DELIVERY and INTRADAY LIMIT order lifecycle  
**Related work:** Draft PR #94, `feature/nse-equity-order-engine-2026-11-23`  
**Safety:** No production migration, RPC rewrite, worker change, or accounting change is authorized by this document.

## 1. Current verified behavior

The existing DELIVERY LIMIT settlement RPC (`execute_paper_limit_fill`) and INTRADAY LIMIT settlement RPC (`execute_paper_intraday_limit_fill`) accept an order only while its status is `PENDING`, settle the complete order quantity, and transition directly to `FILLED`. The existing fill-ledger migration creates append-only `paper_equity_fills` and `paper_equity_cash_ledger` tables, but explicitly leaves existing MARKET/LIMIT RPCs unwired.

The Intraday LIMIT worker scans only `order_type=LIMIT`, `status=PENDING`, `product=INTRADAY`. The shared Delivery eligibility helper also rejects every status except `PENDING`. A partial status without coordinated worker changes would strand the unfilled remainder.

## 2. Required order model

The following are logical requirements; exact column names and constraints must be reconciled with the live schema before a migration is authored.

- Original order quantity is immutable.
- Track cumulative filled quantity and remaining quantity as authoritative database values.
- Invariant: `original_quantity = filled_quantity + remaining_quantity`.
- Require `0 <= filled_quantity <= original_quantity` and `remaining_quantity >= 0`.
- Track cumulative gross, cumulative charges, and cumulative realized P&L in integer paise.
- Track weighted average execution price using integer-safe arithmetic and a documented rounding rule.
- State transitions:
  - `PENDING -> PARTIALLY_FILLED` after a non-terminal execution.
  - `PENDING -> FILLED` after a complete execution.
  - `PARTIALLY_FILLED -> PARTIALLY_FILLED` while remainder remains.
  - `PARTIALLY_FILLED -> FILLED` when remainder reaches zero.
  - `PENDING/PARTIALLY_FILLED -> CANCELLED/EXPIRED` only for the unfilled remainder.
- A terminal order must never accept another new execution.

The schema owner must decide whether quantity totals are stored columns or derived from immutable fill rows. Do not maintain two independently writable sources of truth.

## 3. Execution transaction contract

One database transaction must perform all of the following, or none:

1. Lock the user's paper account first, preserving the established account-first lock order.
2. Re-read and lock the order after the account lock.
3. Validate status, remaining quantity, product, instrument, exchange, tick, session, quote freshness, and limit-price condition.
4. Validate the execution identifier and resolve duplicate execution retries before any new financial mutation.
5. Validate that execution quantity is positive and no greater than the current remaining quantity.
6. Calculate execution gross and charges using the approved fee policy.
7. Apply BUY or SELL position/cost-basis mutation for this execution quantity only.
8. Consume the executed portion of the reservation while retaining a sufficient reservation for the remaining quantity.
9. Insert exactly one immutable fill row and the corresponding cash-ledger event(s).
10. Update cumulative order totals and state.
11. Return the canonical execution receipt.

A retry with the same `(order_id, execution_id)` must return the original receipt and must not change cash, positions, reservations, order totals, or ledger totals again. Reuse of an execution identifier with a different payload must fail closed.

## 4. Reservation conservation

### BUY

- At submission, reserve a conservative amount for the full remaining order using the approved reservation price and charge policy.
- On each fill, debit actual execution gross plus approved charges.
- Reduce the order's reservation by the amount attributable to the executed quantity.
- Keep the reservation for the unfilled remainder.
- On cancel/expiry, release only the remaining reservation.
- At all times, account-level reserved cash must equal the sum of active order reservations under the system's defined reservation model; available cash must not become negative.

### SELL

- Reserve the full submitted share quantity.
- On each fill, reduce both order remaining quantity and the position's reserved quantity by exactly the executed quantity.
- Do not make reserved shares available to another order before the fill transaction commits.
- On cancel/expiry, release only the still-unfilled reserved shares.
- A position may be deleted only when its actual quantity reaches zero and no reservation remains.

The accounting owner must verify whether reservation release is based on proportional original reserve, actual fill notional, or a recomputed remaining-order reserve. Any rounding remainder must be assigned deterministically and conserved.

## 5. Charges and cost-basis decisions requiring owner sign-off

These are blocking policy decisions, not implementation assumptions:

1. **Minimum brokerage:** Is minimum brokerage charged once per parent order, once per execution, or reconciled across the order's cumulative fills?
2. **Other statutory charges:** Which components are computed per execution and which are rounded once at order completion?
3. **Cancellation after partial execution:** How are minimum charges reconciled if the order is cancelled before fully filled?
4. **BUY cost basis:** Confirm whether each fill adds gross plus allocated charges to cost basis, and define allocation for order-level charges.
5. **SELL cost basis:** Define deterministic incremental allocation from remaining position cost basis. The final fill closing a position must consume the exact residual cost basis; no paise may be lost or created through repeated rounding.
6. **Realized P&L:** Confirm whether realized P&L is posted per fill and summed, with order-level values as aggregates.
7. **Ledger event taxonomy:** Confirm the event types and sign conventions for fill debit/credit, reservation create/consume/release, and compensating corrections.

All money calculations must remain integer paise or exact PostgreSQL numeric arithmetic with explicit bounds and rounding rules. JavaScript floating-point arithmetic must not be the accounting source of truth.

## 6. Worker contract

Both Delivery and Intraday workers must be changed together with SQL:

- Scan eligible `PENDING` and `PARTIALLY_FILLED` orders.
- Derive remaining quantity from authoritative database state; never infer it from a stale worker snapshot.
- Worker-side eligibility is advisory only. The SQL transaction must re-check all conditions after locks are acquired.
- A worker cursor must not permanently skip a partial order that remains eligible. Define a fair retry strategy that prevents both starvation and hot-looping.
- A stale quote or failed execution must not advance order state.
- If the worker times out after the database commits, retry the same stable execution identifier so the result is idempotent.
- If the quote provider cannot supply a stable execution identifier, the owner must approve a deterministic execution-key strategy and its limitations before implementation.
- Lease expiry, duplicate worker invocation, and cursor reset must not create duplicate fills.
- Session expiry and cancellation must release only remaining reservations.
- Preserve existing exchange-session and quote-age checks.

## 7. Concurrency and race outcomes

Tests must prove deterministic outcomes for:

- Two workers attempting the same order concurrently.
- Two different orders competing for the same available cash or shares.
- Fill racing with user cancellation.
- Fill racing with session expiry.
- Worker lease expiry while a fill transaction is in flight.
- Timeout after commit followed by retry.
- Duplicate execution ID with identical payload.
- Duplicate execution ID with conflicting payload.
- A second fill arriving after the order becomes terminal.
- Account and position reservation totals under concurrent BUY and SELL operations.

Keep the established account-first lock order across submit, fill, cancel, and expiry paths. Any exception requires a reviewed deadlock analysis.

## 8. Required test matrix

### State and quantity
- Partial first fill, multiple partial fills, exact final fill, overfill rejection, zero/negative quantity rejection.
- Cumulative quantity invariant after every transition.
- No execution on CANCELLED, EXPIRED, or FILLED orders.

### Accounting
- BUY partial fill with price improvement and price movement.
- SELL partial fill with cost-basis rounding remainder.
- Minimum-charge boundary cases and cancellation after partial fill.
- Reservation conservation after each fill, cancellation, and expiry.
- Fill rows and ledger rows exactly match account/position/order mutations.
- Rollback injection proves no partial transaction is persisted.

### Idempotency and concurrency
- All retry and race cases in section 7.
- PostgreSQL integration tests using independent concurrent sessions, not only mocked RPCs.

### Worker lifecycle
- Delivery and Intraday workers repeatedly process remaining quantity.
- Partial orders remain discoverable after cursor advancement/reset.
- Stale quotes, session close, lease expiry, and transient provider failures.
- Worker crash immediately before and after transaction commit.

### Regression and isolation
- Existing full-fill MARKET and LIMIT behavior remains unchanged where intended.
- Existing fee, cash, position, settlement, and idempotency tests pass.
- No Crypto, Futures, or Options code is modified.
- Disposable PostgreSQL migration smoke tests and complete market-gateway CI pass.

## 9. Rollout and migration gates

1. Inventory the actual `paper_orders` schema, status constraints, indexes, triggers, grants, RLS, cancel/expiry RPCs, and all worker queries on the target integration branch.
2. Obtain written approval from Database, Accounting, and Worker owners for the decisions in sections 2, 5, and 6.
3. Implement schema and RPC changes in an isolated feature branch; do not silently modify shared accounting foundations.
4. Deploy additive schema only after migration review; keep partial execution disabled until all RPCs and both workers are compatible.
5. Run migration smoke tests, concurrency tests, accounting conservation tests, and full CI.
6. Enable only after explicit release approval and a rollback plan that preserves append-only audit records.
7. Never rewrite or delete historical fills/ledger entries; corrections must use approved compensating entries.

## 10. Explicit non-goals

- This proposal does not authorize changes to MARKET full-fill behavior.
- This proposal does not authorize Crypto, Futures, or Options changes.
- This proposal does not authorize production migration, deployment, feature activation, or PR merge.
- This proposal does not choose fee policy on behalf of the accounting owner.

## 11. Approval checklist

- [ ] Database owner approves schema, status transitions, constraints, indexes, RLS/grants, and transaction boundary.
- [ ] Accounting owner approves fee rounding, cost-basis allocation, reservation math, and ledger semantics.
- [ ] Worker owner approves Delivery/Intraday scan, retry, cursor, lease, expiry, and cancellation-race design.
- [ ] QA owner approves PostgreSQL concurrency and accounting conservation test plan.
- [ ] Release owner approves staged rollout and rollback plan.

**Until all applicable approvals are recorded, this contract remains design-only.**


## 12. Follow-up schema and lifecycle audit — confirmed blockers

A direct inspection of the existing core and lifecycle migrations confirms the following concrete constraints that must be addressed in a reviewed migration before partial fills can work:

- `paper_orders.status` currently has a CHECK constraint allowing only `PENDING`, `FILLED`, `CANCELLED`, and `REJECTED`. It does not allow `PARTIALLY_FILLED`. There is also no `EXPIRED` status in this constraint.
- The current schema stores only original `quantity`, one `execution_price_paise`, one `gross_paise`, order-level `realized_pnl_paise`, `reserved_cash_paise`, `reserved_quantity`, and `reservation_released`. It has no cumulative filled/remaining quantity or weighted-average execution fields.
- Existing Delivery cancellation accepts only `PENDING`, releases the complete order reservation, and marks the order `CANCELLED`.
- Existing Intraday cancellation likewise accepts only `PENDING`, releases the complete order reservation, and marks it `CANCELLED`.
- Existing Intraday expiry scans only `PENDING` orders and, when session data is missing/closed/elapsed or the order belongs to another IST date, releases the full reservation and marks the order `CANCELLED`; it does not create an `EXPIRED` status.
- Existing LIMIT fill functions require `PENDING`, calculate gross from the full original `quantity`, and settle/release the full reservation.
- The fill table already has a unique constraint on `(order_id, execution_id)`; the cash ledger has a unique constraint on `(user_id, event_key)`. Both tables are append-only and inaccessible to authenticated/anonymous clients. A future execution RPC must use these constraints as part of its atomic idempotency design, not bypass them.
- The core schema enforces `paper_equity_positions.reserved_quantity <= quantity` and account reserves within cash. Every partial-fill and cancellation/expiry transition must preserve these database invariants.

### Decision required: expiry representation

Do not add an `EXPIRED` state by assumption. The database and product owners must choose one of:
1. Add `EXPIRED` to the order status constraint and update every API, worker, UI, analytics query, and idempotency response that interprets terminal statuses; or
2. Keep `CANCELLED` as the terminal status for session expiry and add an explicit immutable/controlled terminal reason such as `SESSION_EXPIRED`.

Whichever option is approved must preserve the current fail-safe behavior for missing or unverified session data and must release only the unfilled remainder after partial execution.

These are verified repository-schema findings, not proposed production changes. No schema, SQL RPC, worker, or accounting code was modified during this follow-up audit.


## 13. Follow-up API, worker and UI compatibility audit

The existing application consumers were inspected because a database-only status change would not be sufficient:

### API and backend
- The authenticated equity order-history endpoint returns the raw order status and currently exposes original `quantity`, but no cumulative filled quantity, remaining quantity, or weighted average fill price.
- The LIMIT submission response path returns order status, but the browser currently validates only `PENDING`, `FILLED`, and `CANCELLED`. A future `PARTIALLY_FILLED` response would be treated as unverifiable and reported as an uncertain response.
- The backend Delivery worker and Intraday worker query only `status='PENDING'`; the worker evaluation helper also rejects any non-PENDING status. Both need coordinated changes to pick up partially filled remainders.
- The current order history endpoint returns at most 100 records and advertises `hasMore:false`; pagination/cursor correctness must be addressed if the UI needs complete execution history. This is not a reason to change the unrelated order-history contract until its owner approves.

### UI
- The OPEN filter already includes `PARTIALLY_FILLED`, and a Hindi label for that status already exists. These are presentation-only accommodations, not evidence that backend partial fills are supported.
- The order-book row renders the original order quantity and has no filled/remaining quantity display.
- Cancellation controls are rendered only for PENDING LIMIT orders. The UI therefore does not currently offer cancellation of a partially filled remainder.
- Trade History currently selects only orders whose final status is `FILLED`. It does not render individual execution rows from `paper_equity_fills`; partial executions would be invisible there until the parent order becomes fully filled.
- The browser-side LIMIT submission response validator rejects `PARTIALLY_FILLED` as an unknown status and its result messaging has no partial-fill state.

### Required coordinated acceptance criteria
Before enabling partial fills, the approved implementation must:
1. Return and validate cumulative filled quantity, remaining quantity, weighted average fill price, and current reservation amounts in API responses.
2. Make both workers and the shared eligibility/evaluation helpers safely process the remaining quantity for PENDING and PARTIALLY_FILLED orders, with SQL authoritative re-checks under locks.
3. Make cancellation of a partially filled order release only the unfilled remainder while preserving prior executions.
4. Display partial execution progress and allow the user to cancel the remaining quantity when policy permits.
5. Render execution history from immutable fill records, including partially filled orders, rather than relying only on final parent-order status.
6. Test old clients, retry/idempotency responses, pagination, worker cursor behavior, and status transitions during staged rollout.

No application, API, worker, database, or UI code was changed during this audit. The items above extend the approval/design requirements only.
