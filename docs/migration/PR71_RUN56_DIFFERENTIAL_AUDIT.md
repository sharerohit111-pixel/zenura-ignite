# PR #71 Run #56 — Differential Coverage Review

Date: 2026-11-22

## Verified CI result

The GitHub Actions run associated with PR #71 head commit `dd0cd5fc8bf3da2a6c0de276774cb75aad97a928` is run **#56 / 44999892511**. The `postgres-migration-smoke` job completed successfully. All 22 numbered workflow steps completed successfully, including:

- Firebase reference charge-calculation boundary tests and option transaction tests.
- Ordered draft migration application to disposable PostgreSQL.
- MARKET idempotency, quote freshness, duplicate concurrency and cash isolation.
- LIMIT reservation lifecycle, duplicate submit, fill/cancel race and null-side rejection.
- Long option transactions, repeated partial-close basis vector, add-on BUY, insufficient-cash rollback and 50-position cap.
- Selected SQL charge/rounding golden vectors and concurrent Options idempotency.
- RLS/privileged RPC boundaries, tenant isolation, schema and RPC registration.

Run #56 is a disposable PostgreSQL/minimal-auth-role test, not a live Supabase Auth/PostgREST integration test or production certification.

## Scope of Firebase-to-SQL parity actually established

The workflow runs `market-gateway/test/trading-charges.test.js` and `market-gateway/test/derivative-order-transaction.test.js` as Firebase JavaScript reference tests. SQL is exercised by separate SQL fixtures and selected golden vectors. The run therefore demonstrates that both suites pass, but does **not** execute every identical input through Firebase and PostgreSQL and compare every output/state transition automatically.

The following are selected parity/reference checks, not full differential coverage:

- Charge/rounding golden vectors, including NSE/BSE examples and tiny-premium SELL.
- Repeated partial-close cost-basis conservation reference vector.
- Selected add-on BUY and option transaction invariants.
- Transaction and concurrency assertions executed in their respective runtimes.

## Remaining differential-test gates

Before claiming full Firebase/Supabase behavioral parity, implement a shared, deterministic fixture contract and run the same vectors through both implementations. Compare integer-paise outputs and normalized state snapshots.

1. **Charges:** NSE/BSE BUY and SELL; all fee components; brokerage overrides; zero brokerage; half-paise boundaries for every rate; safe-integer edges; invalid input atomicity.
2. **Position accounting:** first/add-on BUY; full/partial/repeated SELL; odd/even quantities; fee-inclusive cost basis; weighted average rounding; realized P&L and final position deletion.
3. **Idempotency:** same key/same fingerprint replay; same key/different fingerprint; different order ID with same key; legacy replay behavior; concurrent duplicate requests.
4. **Account constraints:** reserved cash and margin, insufficient unreserved balance, negative/malformed account fields, version bounds and 50-position cap.
5. **Instrument and quote validation:** NSE/BSE segment mapping, CE/PE, lot/tick boundaries, expiry-day 15:30 Asia/Kolkata boundary, stale/future quote, caller/database clock skew, malformed provider metadata.
6. **Atomicity and concurrency:** rejected operations leave cash, order count, reservations and positions unchanged; concurrent BUY/SELL and competing orders yield equivalent final state.
7. **Serialization:** normalize Firebase document fields and SQL rows into a common representation without discarding historical fields that affect user-visible history.

For each shared vector, assert:
- exact equality for integer paise, quantity, order status, reservations, cost basis and realized P&L;
- equivalent normalized persisted order/position/account state;
- both implementations reject invalid inputs before mutation;
- replay and concurrency semantics match.

## Important boundaries

- Do not treat the existing selected vectors as a complete parity matrix.
- Do not apply draft SQL to the connected Supabase project.
- Do not modify Firebase production functions, data, rules, secrets or settings as part of this audit.
- PR #71 and PR #70 remain Draft; PR #28 and its integration branch remain untouched.
- This review is documentation-only and does not change any migration, workflow or runtime code.

## Recommended next isolated task

Build a small shared JSON golden-vector format consumed by Node tests and converted into SQL fixture statements in the disposable PostgreSQL workflow. Start with charge vectors and position accounting; expand only after exact output/state equality is demonstrated. Keep each addition on an isolated audit branch until explicitly approved.
