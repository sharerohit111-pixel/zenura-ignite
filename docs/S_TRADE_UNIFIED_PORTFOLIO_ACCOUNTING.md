# S-TRADE Unified Wallet, Portfolio & P&L Read Model

## Scope
Provider-neutral, read-only aggregation for Indian-market Paper Trading. This module does not execute orders, post ledger entries, reserve funds, fetch quotes, or mutate asset positions. Equity, Futures and Options retain ownership of their accounting engines. Crypto is excluded.

## Canonical balance contract
All monetary values are integer paise.
- Starting capital comes from `paper_accounts.starting_cash_paise`; expected initial grant is 100,000,000 paise (₹10,00,000), initialized once. The read model never resets or tops up an account.
- Cash comes from `paper_accounts.cash_paise`.
- Blocked funds = reserved cash + reserved margin. Do not add asset-level reservations a second time.
- Available cash = cash - reserved cash - reserved margin. Negative values are preserved and margin deficit remains visible.
- Asset adapters provide user-scoped positions, orders and immutable trade receipts. They do not mutate cash or re-add reservations.
- Realized P&L is gross of charges; charges are deducted once in net P&L.
- Position/order/trade IDs must be unique across all three adapters.
- Stale/unpriced open positions make aggregate market value and unrealized/net P&L null.
- Lifetime realized P&L and charges are null unless every adapter proves complete lifetime history. Partial observations are exposed separately, never represented as lifetime totals.

## Adapter contract
Exactly one snapshot for each of EQUITY, FUTURES and OPTIONS is mandatory: `{ asset, complete, positions: [], orders: [], trades: [] }`. An unused asset supplies an empty snapshot. Omitting an adapter must fail closed.
Positions include globally unique positionId, asset, side, positive quantity, costBasisPaise and quote status. Fresh marks require marketPricePaise, quoteTimestampMs, marketValuePaise and unrealizedPnlPaise. Unrealized P&L is market value minus cost basis for LONG and cost basis minus market value for SHORT. Equity DELIVERY/HOLDING rows must be long Equity positions.
Orders include unique orderId, asset, status, remainingQuantity and createdAt. Trades include unique immutable tradeId, asset, realizedPnlPaise, chargesPaise and executedAt.

## Reconciliation and display contract
This aggregator is not an authoritative reconciliation engine. It always returns `ledgerReconciled=false`, `reconciliationStatus=not_reconciled` and `snapshotConsistency=unverified`. Adapter history completeness must never be treated as ledger reconciliation. Keep blockers visible in operator and user-facing diagnostics.
No authenticated unified API route or UI integration is included. Account, positions, orders, fills, reservations and settlement receipts are not yet read under one verified transactionally consistent snapshot.

## Dummy mode
`mode=DUMMY` is deterministic fixture mode only and must never call broker/provider endpoints or be presented as live market data. UI must label it DEMO DATA. This module does not fabricate marks.

## Release gates
1. Coordinate canonical migration ownership/order across Equity #100/#92, Options #122/#129, wallet #131 and Futures #135.
2. Implement one authenticated transactionally consistent snapshot boundary for account, positions, orders, fills, settlement receipts and marks.
3. Independently reconcile cash, reservations, positions, immutable fills/receipts, charges and P&L. Only a verified attestation may ever change the reconciliation flag.
4. Test concurrent reservations, fill/cancel races, replay, two-user isolation, stale marks, pagination and cash/P&L conservation.
5. Run exact-head CI after coordinated rebases. No production migration, deployment, live broker routing or feature activation is included.
