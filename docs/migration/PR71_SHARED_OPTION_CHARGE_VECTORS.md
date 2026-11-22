# Shared Option Charge Vectors — Initial Stage

Date: 2026-11-22

## Added on the isolated compatibility-audit branch

- `market-gateway/test/fixtures/supabase-option-charge-parity-vectors.json`
- `market-gateway/test/supabase-option-charge-parity-vectors.test.js`

The JSON fixture defines five deterministic integer-paise cases:
- NSE standard BUY
- BSE standard BUY
- NSE standard SELL
- NSE BUY half-paise rounding with zero brokerage
- BSE BUY half-paise rounding with zero brokerage

The Node test loads the JSON directly and compares every expected fee component and settlement field with the existing Firebase reference function `calculateLongOptionTradeCharges`.

## Scope and limitations

This is the first shared-fixture stage only. It establishes one machine-readable vector source and a Firebase-reference consumer. It does **not yet** execute the same JSON vectors against PostgreSQL, and it is not evidence of Firebase/Supabase parity.

The vector expectations are grounded in the current reference implementation and existing boundary-test assertions. The fixture is deliberately small; it does not yet cover SELL rounding for every fee component, safe-integer limits, invalid inputs, or account/position state transitions.

No existing runtime, migration, workflow, PR #28, PR #70, or PR #71 files were modified. No tests were executed in this environment because the repository runtime is not mounted here. The new Node test must be run in GitHub Actions or a suitable Node environment before its result can be claimed.

## Next isolated increment

Add a disposable-PostgreSQL consumer that reads this exact JSON file and independently evaluates the SQL charge formula, then compares each SQL result to the fixture's expected values. Do not derive SQL expectations from the JavaScript calculator at test time. Only after that succeeds should the shared fixture expand to position/accounting vectors.

## Disposable PostgreSQL consumer added

The isolated audit branch now includes `market-gateway/test/run-supabase-option-charge-parity.js`. It reads the same JSON fixture and submits each vector to PostgreSQL, calculating exchange fee, IPFT, SEBI, stamp duty, STT, GST, total charges and settlement in SQL. It compares every returned field and the result field set to the fixture's expected values.

The manual `Audit — Supabase role and RLS security checks` workflow now invokes this runner after applying PR #70 migrations to its disposable PostgreSQL 16 service. It does not connect to the live Supabase project and does not change PR #70 or PR #71.

**Execution status:** The runner and workflow wiring are committed, but no workflow run has yet executed this new step. Do not treat the vectors as passed until a new manual Actions run completes successfully. This remains a five-vector charge-calculation parity check, not full transaction/accounting parity.
