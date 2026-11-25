# S-TRADE Round 2 — Shared Demo Consumer Adapter

## Purpose
Provide a single browser-safe, deterministic view-model adapter over the canonical PR #137 Mock JSON fixtures. This is the first consumer-side integration seam; it does not replace or import any order engine, market provider, account service, worker or ledger.

## Contract
- Input: canonical market, account, equity, and derivatives v1.0.0 envelopes.
- Output: one read-only view model with provider DUMMY_JSON, mode DEMO, simulated true, normalized instruments, account, orders, positions, and synthetic depth.
- Explicit opt-in is mandatory: createPaperDemoViewModel(fixtures, { enabled: true }).
- Production mode is explicitly rejected. No default runtime fallback is provided.
- Synthetic instruments must have MOCK| instrument keys and MOCK-prefixed symbols; quotes must have provider MOCK. Actual NSE/BSE symbols and provider-labelled live quotes are rejected.
- All money remains integer paise. Wallet reconciliation flag is carried through unchanged and is not promoted to true.
- Adapter is pure: no fetch, storage, auth, credentials, order submission, quote generation, or mutation of source fixtures.

## Screen integration sequence
1. Home/Market/Watchlist/Charts consume model.market and model.meta.
2. Orders/Positions/Holdings consume model.orders and model.positions; only fixture examples are displayed, never executed.
3. Account/Portfolio consume model.account; display unreconciled state until canonical ledger/read-model work is complete.
4. Futures and Options screens consume model.derivatives only for demo instrument/contract selection. Existing order engine and risk/margin services remain separate.
5. Settings can opt into/out of the demo route. Production authenticated routes must not import this adapter.

## Not included
- This PR does not wire the adapter into PR #138 dashboard or PR #139 chart workspace. Those are separate PR heads with different fixture shapes. Screen wiring requires a coordinated follow-up after adapter contract review.
- No Crypto, live API, broker connection, production route, database migration, or ledger change.
