# S-TRADE Cross-Asset Portfolio Receipt Contract (Draft)

## Status and safety
Design/test contract only. This document does not add tables, RPCs, routes, workers, provider calls, or accounting writes. It excludes Crypto. All money is integer paise. All fixtures must run inside disposable PostgreSQL and roll back. Keep `ledgerReconciled=false` until a separate authoritative reconciliation attestation exists.

## Why normalization is required
The current asset histories are not interchangeable:
- Equity execution history: `paper_equity_fills`; cash/reservation history: `paper_equity_cash_ledger`; order lifecycle: `paper_orders`.
- Futures LIMIT executions: `paper_futures_fills`; MARKET execution/accounting currently lives in `paper_futures_orders` and its transactional position/account mutations. `paper_futures_risk_events` records risk/MTM/expiry/square-off events, not a complete execution-fill stream.
- Options MARKET executions: FILLED rows in `paper_derivative_orders`; LIMIT executions: `paper_option_limit_fills` joined to `paper_option_limit_orders`; expiry payout: `paper_option_expiry_settlements`.
A normalized reader must not mistake a risk event for an execution, or count an expiry settlement as a second trade fill.

## Canonical read envelope
One snapshot envelope is returned for the authenticated user:
```json
{
  "snapshotId": "opaque-id",
  "snapshotVersion": 0,
  "asOf": "database timestamp",
  "mode": "DUMMY",
  "ledgerReconciled": false,
  "snapshotConsistency": "unverified",
  "account": {
    "currency": "INR",
    "startingCashPaise": 100000000,
    "cashPaise": 0,
    "reservedCashPaise": 0,
    "reservedMarginPaise": 0,
    "availableCashPaise": 0,
    "marginDeficitPaise": 0,
    "version": 1
  },
  "assets": {
    "EQUITY": { "coverage": {}, "positions": [], "orders": [], "executions": [], "settlements": [], "accountingEvents": [] },
    "FUTURES": { "coverage": {}, "positions": [], "orders": [], "executions": [], "settlements": [], "accountingEvents": [] },
    "OPTIONS": { "coverage": {}, "positions": [], "orders": [], "executions": [], "settlements": [], "accountingEvents": [] }
  },
  "marks": { "markSetId": "fixture-version", "asOf": "database timestamp", "items": [] },
  "diagnostics": []
}
```
The sample values are shape examples, not financial fixtures or defaults. Missing account/asset adapters must fail closed; an unused asset must return an explicitly empty adapter with evidence of a complete bounded query.

## Normalized row semantics

### Positions
Required: `asset`, `positionId`, `instrumentKey`, `side`, positive `quantity`, `costBasisPaise`, `sourceTable`, `sourceKey`, `updatedAt`. Futures quantity may be signed in storage; normalize side and absolute quantity without losing the original signed quantity in `sourceFacts`. Equity and long Options are long positions. A position is not a fill and must never be added to execution totals.

### Orders
Required: globally unique `orderId`, `asset`, `status`, `quantity`, `filledQuantity`, `remainingQuantity`, `createdAt`, source identity. Pending/partially filled orders require positive remainder; filled/cancelled orders must preserve their source quantities and lifecycle. Orders do not contribute turnover, charges, or P&L.

### Executions
Required: globally unique `executionId`, `asset`, `orderId`, `side`, `quantity`, `executionPricePaise`, `grossPaise`, explicit `chargesPaise`, explicit `realizedPnlPaise`, `executedAt`, `sourceTable`, `sourceKey`, `simulationOnly=true`. Missing money fields are unknown/error, never silently zero.
- Equity maps one row per `paper_equity_fills.fill_id`. Its paired cash-ledger entry is supporting accounting evidence, not another execution.
- Futures LIMIT maps one row per `paper_futures_fills.fill_id`. Futures MARKET can be represented from a FILLED `paper_futures_orders` row only where the schema proves one order equals one complete execution. Do not infer partial fills or fabricate execution IDs from mutable state.
- Options MARKET maps FILLED `paper_derivative_orders.order_id` as one receipt only while the MARKET-only schema guarantees one complete order execution. Options LIMIT maps each `paper_option_limit_fills.fill_id`; do not also count its parent order as an execution.

### Settlements and accounting events
Keep settlement and accounting event streams separate from executions:
- Options expiry maps `paper_option_expiry_settlements.settlement_id` to a settlement receipt with gross payout, exercise STT, net payout and realized P&L; its source hash/reference and supported NSE cash-settled index contract must remain visible.
- Futures `paper_futures_risk_events` maps to risk/accounting events (DAILY_MTM, MARGIN_REFRESH, EXPIRY_SETTLEMENT, SIMULATED_SQUARE_OFF). Never sum these into execution realized P&L unless an explicit, tested accounting rule assigns that event type to a distinct P&L component.
- Equity cash ledger entries are accounting evidence keyed by `ledger_id` and `event_key`; they are not fills. Preserve event type, cash delta, reserved-cash delta and source fill/order references.

Every normalized row carries `sourceTable` and `sourceKey`; source identities must be unique within the snapshot. Preserve source facts needed to audit the mapping. If a source cannot prove a normalized semantic, return a diagnostic and mark that stream incomplete rather than guessing.

## Coverage contract
Each asset reports independent coverage for `positions`, `orders`, `executions`, `settlements`, and `accountingEvents`:
- `complete`: boolean;
- `scope`: `LIFETIME`, `PARTIAL`, or `UNKNOWN`;
- `evidenceRef`: non-empty bounded-query/coverage proof;
- `rowCount`, `asOf`, and optional `nextCursor`.
Lifetime realized P&L/charges are null unless every required execution and settlement stream proves complete lifetime coverage. Cursor pagination must be bound to the same snapshot ID/version and must not silently combine pages from different snapshots.

## Balance and valuation invariants
- Account totals are authoritative for cash and total reserved cash/margin. Do not add asset reservations again.
- Available cash = cash - reserved cash - reserved margin; preserve negative results.
- Margin deficit = max(0, reserved cash + reserved margin - cash), and must match the stored/generated value.
- Execution charges are counted once. Cash-ledger evidence is not another charge source.
- Realized P&L is reported with explicit gross/net semantics; never add settlement realized P&L twice.
- All marks in one response share a mark-set ID/version and as-of timestamp. Stale, future, missing, mixed-version or unpriced marks suppress aggregate market value/unrealized P&L.
- DUMMY mode must use deterministic local fixtures only and must not invoke Upstox, broker, or any provider endpoint.

## Disposable fixture and concurrency acceptance matrix
1. Seed two isolated auth users and one initialized account each; verify every source row is scoped to the owning user.
2. Seed Equity BUY/SELL fill plus paired cash-ledger entries; prove one execution, one charge count, and no ledger-as-fill double count.
3. Seed Futures LIMIT partial fills plus pending remainder; prove distinct fill IDs and order remainder. Seed Futures MARKET filled order; only map one execution if the one-order/one-execution contract is verified. Seed risk events and prove they remain accounting events.
4. Seed Options MARKET order, Options LIMIT partial fills, and expiry settlement; prove no parent-order/child-fill duplication and settlement stays separate.
5. Assert duplicate source keys, missing explicit charges/P&L, unknown mapping, missing adapter and incomplete lifetime coverage fail closed.
6. Run two PostgreSQL sessions: Session A begins the snapshot statement and pauses after establishing its MVCC snapshot; Session B commits one fill + account/position/reservation mutation; Session A resumes. Every returned account/asset row must represent the same pre-commit or post-commit database snapshot, never a mixed state.
7. Repeat the race for fill/cancel, reservation release, Futures MTM/margin refresh and Options settlement; use deterministic barriers, not sleeps alone.
8. Verify forged user IDs cannot select another user's rows; RPC derives identity from `auth.uid()` and accepts no user ID argument.
9. Verify stale/future/mixed mark sets, pagination across snapshot versions, exact replay and repeated calls.
10. Assert `ledgerReconciled=false` and `snapshotConsistency=unverified` for all cases until an independent attestation is deliberately supplied.

## Hard blockers before SQL fixtures/RPC
1. Coordinate the integration base so Equity ledger, Futures risk/market/limit schemas and Options market/limit/settlement schemas are all present in one ordered migration chain. Do not assume draft PR migrations are hosted or merged.
2. Confirm whether Futures MARKET order rows are guaranteed single complete executions, and whether any legacy order can be filled without a complete immutable receipt.
3. Define a canonical Futures cash/realized-P&L event source; risk events are not a substitute for a complete execution ledger.
4. Specify the snapshot statement's isolation behavior and a deterministic two-session test harness. A generated UUID or account version alone does not prove MVCC atomicity.

## Explicit non-goals
No write RPC, broker order, provider feed, worker enablement, hosted database mutation, production deployment, auth-policy change, or crypto modification. Delivery LIMIT worker remains disabled.
