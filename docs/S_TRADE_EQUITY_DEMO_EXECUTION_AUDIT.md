# S-TRADE Equity Demo Execution Engine

Date: 2026-11-24
Scope: isolated deterministic Mock/Dummy cash-equity execution only.

## Existing implementation audited

- PR #92 provides the append-only Equity fill/cash-ledger foundation, but explicitly does not implement partial-fill lifecycle.
- PR #94 documents current Equity MARKET/DELIVERY LIMIT/INTRADAY LIMIT whole-order fills and records partial fills as unsupported.
- PR #100 hardens immutable Equity ledger events and reservations; its known limitations still include no partial fills.
- PR #111 preserves the existing authenticated order engine and confirms partial fills require coordinated database/accounting/worker-owner approval.
- The current shared Mock JSON fixtures are test/demo-only and are not imported by the Supabase gateway. The existing Equity fixture was a single already-filled example, not a deterministic depth-driven execution tape.

## Added isolated simulator

- `mock/fixtures/equity-execution.json` is a fixed, explicitly synthetic book. It uses a `MOCK|SIM|` instrument key, `exchange=NONE`, `provider=MOCK`, and `fees=NOT_MODELED`.
- `lib/equity-demo-execution-engine.js` is a pure in-memory demo engine. It is not imported by `supabase-server.js`, production routes, worker processes or live order code.
- Supports simulated MARKET/LIMIT BUY/SELL for DELIVERY and INTRADAY, deterministic depth-level fills, partial/full fill states, integer-paise reservations, cash/position projections, order idempotency, cancellation of the unfilled remainder and detached per-fill receipts.
- SELL fills realize P&L against the simulated product-specific position cost basis. DELIVERY and INTRADAY positions remain separate.
- Every fill has a deterministic ID and fixture-relative timestamp. The simulator does not call a clock, network, broker, exchange or live provider.

## Explicit non-goals

- No change to authenticated Equity MARKET/LIMIT route, SQL/RPC, production worker, order schema, migrations, fee master, shared ledgers, RLS, Supabase Auth, Upstox or Crypto.
- No actual exchange tick/session validation or execution claim. The book is synthetic, not an NSE/BSE market-depth snapshot.
- Brokerage, STT, GST, exchange charges and DP charges are intentionally **not modelled**. This simulator must not be used for wallet/ledger truth or live account valuation.
- This demo engine is not a substitute for the production partial-fill lifecycle. That requires coordinated SQL reservations/fill RPCs, worker ownership, immutable fill/cash-ledger writes, account locking and PostgreSQL race/RLS tests.

## Validation

Focused tests cover fixture provenance, production fail-closed behavior, deterministic depth sweeps, partial/full fills, LIMIT marketability, BUY cash reservation, SELL share reservation, cumulative P&L, cancellation of only the unfilled quantity, idempotent replay, insufficient resources, separate product books, detached receipts and fixed timestamps.
