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

## Repository integration audit — 24 Nov 2026
The existing gateway routes and dependency PRs were inspected before wiring any adapter. The current sources are not yet safe to combine into a single read endpoint:

| Asset | Existing user-scoped source tables / read model | Blocking issue |
|---|---|---|
| Account | `paper_accounts` via authenticated user client | Wallet route reads account independently from every asset query. |
| Equity | `paper_equity_positions`, `paper_orders`; draft ledger work adds `paper_equity_fills` and `paper_equity_cash_ledger` | #100 is Draft/unmerged. Its own audit states existing MARKET/LIMIT RPCs historically lack complete immutable fill/cash-ledger coverage and partial-fill lifecycle remains incomplete. |
| Futures | `paper_futures_positions`, `paper_futures_orders`; risk/settlement state and events in #135 | #135 is Draft/unmerged and the risk journal is not a replacement for immutable execution fills or a canonical cross-asset cash ledger. |
| Options | `paper_derivative_positions`, `paper_derivative_orders`, `paper_option_limit_orders`, `paper_option_limit_fills`, `paper_option_expiry_settlements` | #122/#129 are Draft. Existing Options endpoint loads multiple pages/table reads separately and obtains Upstox marks; it is not one repeatable-read snapshot. |

### Why an API-only Promise.all aggregation is rejected
The current wallet, Equity, Futures and Options endpoints issue independent PostgREST requests. Parallel requests do not share a PostgreSQL transaction snapshot. A fill, cancellation, margin refresh or settlement can commit between reads, producing a portfolio that never existed at one instant. The existing Options/Futures valuation routes also acquire Upstox quotes, so they cannot be reused for deterministic DUMMY mode. The current Equity route similarly requires instrument/quote-provider availability.

Do not call these endpoints from a new aggregator, and do not treat their responses as one atomic portfolio. A safe implementation needs one authenticated SECURITY DEFINER RPC (or equivalent single repeatable-read transaction) that:
- derives `auth.uid()` internally and accepts no caller-supplied user ID;
- reads `paper_accounts`, all three position/order/fill/receipt sources and the relevant reservation/settlement state under one transaction snapshot;
- emits bounded, deterministic rows with explicit per-asset history completeness and source/version metadata;
- does not add asset reservations again when account-level reserved cash/margin already includes them;
- keeps mark acquisition outside the database transaction but attaches a single timestamped, deterministic mark set to the returned snapshot; DUMMY fixtures never call broker/provider APIs;
- returns `ledgerReconciled=false` until independently computed cash/position/receipt conservation is attested.

### Migration coordination blocker
The dependency PRs use separate bases and are not merged. In particular, #100 adds Equity immutable ledger structures and rewires several RPCs; #135 adds a generated margin-deficit column and Futures risk/settlement tables; #122/#129 add Options history/settlement behavior; #131 owns account initialization and wallet reads. A new migration referencing all these objects now would fail on the current wallet base or assume a migration order that has not been accepted. Do not create that migration until the dependency owners agree on one ordered integration base and the exact schemas are present there.

### Route and mode behavior observed
- `GET /paper/account` initializes/reads the authenticated account and returns the wallet snapshot.
- `GET /paper/portfolio` reads Equity account/positions and obtains provider quotes.
- `GET /paper/futures/portfolio` independently reads account/positions and obtains provider quotes.
- `GET /paper/options/accounting` independently pages account/positions/orders/fills/settlements and obtains Upstox quotes.
These are useful existing feature routes, not a shared snapshot API. They must remain unchanged until a coordinated atomic boundary is available.
