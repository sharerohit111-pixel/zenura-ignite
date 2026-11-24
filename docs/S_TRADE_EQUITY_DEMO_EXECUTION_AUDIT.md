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

## Overlap audit: PR #146 vs PR #148 (2026-11-24)

- PR #146 adds a second standalone browser engine at `markets/stocks/equity-dummy-engine.js`, its own fixture contract, tests and a separate `equity-demo.html` page. It duplicates the same Equity Demo lifecycle and must not be merged alongside PR #148.
- PR #148 is the canonical implementation because it uses the shared `MOCK` JSON fixture contract, the reusable gateway-side simulator, the existing Market Dashboard Demo workspace and a dedicated Mock Contract CI workflow.
- PR #146 is superseded for implementation/UI purposes. Preserve its useful regression intent in the canonical engine tests; do not import its engine, fixtures or standalone page into the shared Market Dashboard.
- The canonical engine remains in-memory and demo-only. It is not wired into authenticated production routes or the private order ledger. Production Equity SQL/RPC, workers, reservations, fee master and accounting remain untouched.
- The canonical simulator now supports optional stable execution IDs for `matchNext`: replaying the same ID returns the original detached result without applying a second fill; reusing it for another order is rejected. Callers that do not provide an execution ID retain the existing one-book-level-per-call behavior.
- Regression coverage also checks that repeated partial SELL fills allocate the exact residual cost basis when the position is fully closed.
- PR #148 remains Draft pending CI on the latest head and review; PR #146 should remain explicitly marked superseded and unmerged.
