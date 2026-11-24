# S-TRADE Unified Wallet, Portfolio & P&L

## Purpose
Provider-neutral read-only aggregation for Indian-market Paper Trading. It does not execute orders, post ledger entries, reserve funds, fetch quotes or mutate asset positions. Equity, Futures and Options retain ownership of their execution/accounting engines. Crypto is excluded.

## Audited dependency state — 24 Nov 2026
- PR #122: Draft Options read model; long NSE CE/PE positions, paise arithmetic, LIMIT BUY premium reservation, SELL close reservation reconciliation, fresh-quote valuation and MARKET/LIMIT fill history. Aggregate API integration was pending.
- PR #129: Draft hardening of #122; authenticated paginated Options accounting endpoint, immutable fills/expiry receipts and charge reconciliation. It still uses Upstox-specific quote acquisition, lacks one transactionally consistent multi-table snapshot, and retains expiry-source authenticity/worker fences as blockers.
- PR #131: Draft account/auth/wallet; idempotent ₹10,00,000 initialization and authenticated wallet snapshot. It explicitly reports ledgerReconciled=false and derives available cash from paper_accounts, not a cross-asset ledger.
- PR #135: Draft Futures risk/settlement ledger; margin state, daily MTM, settlement and square-off events. Existing Futures order/fill accounting remains in its own RPCs. NSE only; official automated settlement ingestion remains outstanding.
- Equity PR #100 (dependency PR #92): Draft append-only Equity cash/trade ledger hardening. Its own scope lists partial fills, refund/reversal, full portfolio reconciliation, T+1 simulation and intraday square-off as follow-up items.
All relevant workstreams are Draft/unmerged and use different bases. This PR adds an isolated read model on the wallet branch; it does not merge or rewrite their migrations.

## Canonical balance contract
All monetary values are integer paise.
- Starting capital is paper_accounts.starting_cash_paise; initial grant is 100,000,000 paise (₹10,00,000), idempotent and never reissued on retry.
- Cash is paper_accounts.cash_paise, the transactional spendable-balance authority until a canonical cross-asset ledger transition is approved.
- Blocked funds = reserved_cash_paise + reserved_margin_paise. Do not add asset-level reservations again.
- Available cash = cash_paise - reserved_cash_paise - reserved_margin_paise. Preserve negative values and expose margin deficit; never clamp a genuine Futures MTM debit.
- Asset adapters return user-scoped positions, orders and immutable trade receipts; they do not mutate account cash or re-add reservations.
- Realized P&L is gross of charges; charges are separately summed from unique immutable trade/settlement receipts and deducted exactly once in net P&L. Do not feed net-of-charge realized values into this adapter. Do not count position summaries or Futures risk events a second time.
- Position IDs, order IDs and trade IDs must each be globally unique across the three asset adapters in one user snapshot.
- Unrealized P&L uses fresh timestamped marks and cost basis. Any stale/unpriced open position makes aggregate market value and unrealized/net P&L null.
- Lifetime net P&L is null unless every asset adapter declares its history complete. Bounded latest-N history must set complete=false.

## Adapter contract
Exactly one snapshot per asset: { asset, complete, positions: [], orders: [], trades: [] }, asset is EQUITY, FUTURES or OPTIONS.
Positions include positionId, asset, quantity, costBasisPaise, quoteStatus and, for fresh marks, marketPricePaise, quoteTimestampMs, marketValuePaise, unrealizedPnlPaise. Equity DELIVERY positions are holdings; Equity intraday, Futures and Options remain positions.
Orders include globally unique orderId, asset, status, remainingQuantity and createdAt. Trades include globally unique immutable tradeId, asset, realizedPnlPaise, chargesPaise and executedAt. Adapters own deterministic pagination and source deduplication.

## Dummy mode
mode=DUMMY is deterministic fixture mode only, simulation-only, and must never call broker/provider endpoints or be presented as live market data. Dummy quote snapshots need deterministic fixture timestamps and the UI must show DEMO DATA. This module never fabricates a mark.

## Release gates
1. Coordinate Equity #92/#100, Futures #135, Options #122/#129 and wallet #131 onto one canonical migration owner/order. Do not blindly merge independent migration timestamps.
2. Add one transactionally consistent authenticated snapshot boundary (single RPC or repeatable-read transaction) for account, positions, orders, fills, settlement receipts and marks.
3. Establish cross-asset event identity/idempotency; append-only event tables with RLS, service-role-only writes, immutable rows and tenant-safe foreign keys.
4. Ensure reservation, partial fill, cancel, reversal, expiry and settlement update cash and asset ledgers exactly once.
5. Test cross-asset concurrent reservations, fill/cancel races, replay, two-user isolation, stale marks, pagination beyond 100/500 rows, and cash/P&L/charges conservation from an empty disposable PostgreSQL database.
6. Run exact-head CI after final rebases. Draft CI is not production validation. No production migration, deployment, live broker routing or feature activation is included.
