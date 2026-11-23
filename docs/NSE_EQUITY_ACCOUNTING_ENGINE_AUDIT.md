# NSE Equity Accounting Engine — Existing Implementation Audit

**Date:** 2026-11-23  
**Repository:** sharerohit111-pixel/zenura-ignite  
**Audit branch:** feature/nse-equity-accounting-engine-2026-11-23  
**Base:** feature/indian-equity-lifecycle-audit-2026-11-23 (PR #92 head)  
**Scope:** NSE cash-equity accounting and portfolio only. Crypto, Futures, Options and the separate NSE Equity Order Engine branch are excluded.

## Executive result

The repository already has atomic aggregate accounting for equity MARKET orders and DELIVERY LIMIT orders, including fee-inclusive cash movements, position cost basis and realized P&L. A draft append-only fill/cash-ledger schema was added in PR #92, but it is not connected to the order RPCs. Consequently, the current system cannot independently prove a complete cash-movement history or reconcile aggregate account/position state against immutable execution records.

**Accounting engine is not release-ready.** PR #92 is open and Draft; no production migration, deployment or merge was performed by this audit.

## Existing implementation observed

- paper_accounts: integer-paise cash, reserved cash, reserved margin, aggregate and product-specific realized P&L, version counter. Constraint prevents cash reservations exceeding cash.
- paper_equity_positions: one row per user/product/instrument; quantity, average price, total cost basis and reserved sell quantity. Delivery and Intraday positions are isolated by product.
- paper_orders: idempotency key and request fingerprint, execution/gross/charge/cash-delta fields, order status and reservation metadata.
- MARKET RPC: account row lock, idempotency replay/fingerprint check, unreserved cash/share validation, position mutation, fee calculation and order receipt persisted in one transaction.
- DELIVERY LIMIT RPCs: submit reserves estimated cash (BUY) or shares (SELL); fill/cancel serialize through account and order locks; fee-inclusive settlement is present in later draft migrations.
- NSE fee schedule: integer-paise calculation with a version label and indicative=true; BSE fee-aware code uses a classification master and fails closed when inputs are missing.
- PR #92 adds paper_equity_fills and paper_equity_cash_ledger, unique execution/event keys, RLS, service-role-only table grants and UPDATE/DELETE rejection triggers.

## Findings

### Critical — ledger is schema-only, not authoritative
The existing MARKET and LIMIT settlement RPCs do not insert paper_equity_fills or paper_equity_cash_ledger. A successful order therefore updates aggregate cash/positions/order receipt without a corresponding immutable fill and balanced ledger event. Reconciliation is impossible from the new tables until the writes are made inside the same transaction as the accounting mutation.

### Critical — no partial-fill accounting lifecycle
Equity LIMIT state currently supports PENDING/FILLED/CANCELLED/REJECTED in the base schema. The existing fill RPC consumes the complete remaining order quantity in one execution. There is no durable cumulative filled quantity, remaining quantity, weighted-average fill price or per-fill charge allocation for equity partial executions.

### High — reservation lifecycle is not independently auditable
Aggregate reserved cash and position reserved quantity are maintained, but there are no authoritative ledger rows written for reservation creation, consumption, release, cancellation or expiry. The draft ledger event shape does not itself enforce non-zero/appropriate reservation deltas or a complete one-to-one relationship between a fill and its required cash movement.

### High — ledger schema permits incomplete/mismatched audit relationships
paper_equity_fills uniquely constrains (order_id, execution_id), and the cash ledger uniquely constrains (user_id, event_key). However, it does not enforce that fill.user_id matches the referenced order owner, that a ledger row's fill and order belong to the same user/order, or that every fill has exactly one corresponding trade debit/credit. These invariants must be enforced in trusted transaction RPCs and reconciliation assertions (or strengthened with suitable composite constraints).

### High — correction/reversal path is not implemented
The append-only triggers correctly reject UPDATE/DELETE, but there is no dedicated compensating reversal/refund transaction with a unique reversal identity, original-event reference and atomic account/position correction. ADJUSTMENT is currently a broad event type and needs stricter authorization, reason/reference requirements and bounded sign semantics.

### High — settlement is immediate simulation accounting, not dated clearing
Current equity fill RPCs mutate cash and positions immediately. There is no explicit trade-date/value-date model, unsettled cash, settlement batch, delivery obligation or settlement reversal. This must be described as immediate paper settlement unless a separate T+1 settlement simulation is implemented.

### High — Intraday square-off not established by accounting schema
Intraday positions are stored separately, but a separate accounting-grade square-off lifecycle (cut-off policy, deterministic close execution, idempotency, charges, failure/retry handling and audit event) is not established by the inspected accounting tables and MARKET/DELIVERY LIMIT paths. It must be verified/implemented as an isolated equity-only workflow.

### Medium — available balance is derived, not ledger-derived
The current available amount is cash_paise - reserved_cash_paise - reserved_margin_paise. This is a valid aggregate formula when all mutations preserve the reservation invariant, but there is no immutable event stream from which to independently recompute it. Equity-only presentation must also avoid accidentally treating Futures margin as an equity reservation while preserving the shared account's cross-product solvency invariant.

### Medium — average price and cost basis need invariant coverage
BUY adds fee-inclusive net debit to cost basis and recomputes rounded average price. SELL allocates proportional cost basis with a final-close residual rule and realizes net sale proceeds less allocated basis. This is a sensible integer-paise approach, but the equity test suite needs repeated partial closes, multiple BUY lots, rounding residual and cross-product separation assertions.

### Medium — charges are indicative
The code labels its charge breakdown as indicative and versioned. It must remain explicitly simulated/indicative; schedule inputs, DP applicability, exchange and statutory rates require independent refresh before release. BSE must remain fail-closed when scrip-group/exclusive-category data is unavailable.

## Required accounting invariants

1. All monetary values and fee allocations are integer paise; reject overflow before mutation.
2. Each logical request is idempotent by (user_id, idempotency_key) and immutable request fingerprint.
3. Each execution is unique by (order_id, execution_id); replay returns the original result and never creates another fill or cash event.
4. One database transaction must write order/fill, cash ledger, position, account balance, reservations and realized P&L.
5. BUY: cash debit = gross + buy charges; fee-inclusive amount enters position cost basis.
6. SELL: cash credit = gross - sell charges; realized P&L = net proceeds - allocated fee-inclusive cost basis.
7. 0 <= reserved_cash + reserved_margin <= cash; 0 <= reserved_quantity <= held_quantity.
8. Available cash = cash - reserved cash - reserved margin; no mutation may consume another order's reservation.
9. Fill/cancel/expiry/square-off races serialize under a documented lock order and only one terminal transition wins.
10. Refunds/reversals are new compensating entries, never mutation/deletion of historical rows.
11. Reconciliation must compare account cash/reserves and positions/cost basis/realized P&L against the immutable event/fill history and fail closed on any mismatch.
12. Delivery and Intraday holdings remain separate; settlement-date simulation must not be conflated with immediate paper execution.

## Implementation sequence

1. Strengthen the draft ledger/fill schema with owner/order consistency and explicit reversal linkage.
2. Add isolated equity accounting RPC wrappers or forward-only SQL replacements that atomically write fill and ledger events for MARKET, LIMIT fill, cancellation and expiry. Coordinate interfaces with the separate order-engine chat; do not edit its files.
3. Add equity partial-fill state and cumulative reservation/fee allocation only after agreeing the order-engine interface.
4. Add intraday square-off and dated settlement simulation as separate equity-only transactions.
5. Add reconciliation and accounting-conservation tests for BUY/SELL, partial fills, cancellation, duplicate retries, concurrent fills/sells, refunds/reversals and cross-product isolation.
6. Run the full disposable PostgreSQL migration/test workflow; do not apply production migrations, deploy or merge without separate approval.

## Isolation and safety

This audit created a new branch from the PR #92 head. It did not modify PR #92, the shared integration branch, the dedicated NSE Equity Order Engine branch, Crypto, Futures or Options. Production Supabase and deployment were not touched.


## CI regression follow-up (2026-11-23)

- The Intraday LIMIT fill-vs-cancel race test now passes with immutable fill/ledger foreign keys enabled. Its cleanup retains the successfully filled BUY order and records a compensating CI-only cash adjustment rather than deleting the fill or leaving the account reset unaudited.
- A subsequent MARKET settlement test exposed a global `paper_orders.order_id` collision: the race test intentionally retains its filled order ID (`repeat('a',64)`), while the MARKET test reused that same ID for a different user. The MARKET test fixtures now use distinct order IDs (`m` through `r`) to respect the global primary key. This is test isolation only; production order IDs remain unchanged.
- Latest validation must be rerun against the updated branch head before marking the MARKET, Delivery LIMIT, ledger schema, and ledger integrity tests green.
