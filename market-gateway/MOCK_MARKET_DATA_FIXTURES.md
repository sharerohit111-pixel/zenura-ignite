# S-TRADE Synthetic Instrument and Market Data Fixtures

This fixture set is for deterministic paper-trading development and automated tests only.

- Instrument master: `fixtures/mock-instrument-master.json`
- Synthetic reference-price seeds: `fixtures/mock-market-snapshots.json`
- Provider facade and filters: `lib/mock-market-data.js`
- Tests: `test/mock-market-data.test.js`

Every response identifies itself as `SYNTHETIC_MOCK_JSON`, sets `isLive: false`, and carries the `DEMO DATA · SYNTHETIC ONLY` label. Prices, candles and depth are deterministic test values, not exchange observations or indicative quotes.

The reference date is fixed at 2026-11-24 so expiry and strike tests are repeatable. Callers can pass an explicit `asOf` date to expiry/filter functions. Contract metadata is illustrative and must not be used as a live exchange instrument master.

The module has no network client, broker credentials, provider adapter, order execution, persistence, wallet, ledger, accounting, or Crypto dependencies. It reuses the existing instrument search ranking helper.
