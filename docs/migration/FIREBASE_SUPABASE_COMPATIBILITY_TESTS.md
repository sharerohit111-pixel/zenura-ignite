# Firebase → Supabase compatibility test scope

## Isolation and execution

These tests are part of the existing `market-gateway` Node test suite. From the repository root, run:

```sh
cd market-gateway
npm test
```

The package test script uses Node's built-in test runner (`node --test test/*.test.js`). The compatibility tests added here are pure, local tests: they use synthetic JSON fixtures and do not connect to Firebase, Supabase, Upstox, or any production service.

No database migration is executed by these tests. The normalizers produce in-memory staging objects only and are not wired into production routes or the runtime data path.

## Added coverage

- Firebase UID → explicitly supplied Supabase Auth UUID mapping; no automatic identity guessing.
- INR integer-paise balances, historical starting capital, Delivery/Intraday/Derivative position separation, and legacy P&L fallback.
- Cash-order Firestore document ID and request fingerprint retention; no fabricated legacy raw idempotency UUID.
- LIMIT BUY/SELL reservation amounts, lifecycle state, and preservation of reservation audit fields after release.
- Derivative order metadata and full historical charge-component JSON preservation.
- Watchlist allow-list, legacy `instrumentKeys` fallback, deduplication, and 50-symbol cap.
- OAuth state expiry/one-time-use validation and explicit exclusion of OAuth state, encrypted connection envelopes, stream leases, worker cursors, connection controls, and margin rate-limit state from bulk migration.

## Important migration boundaries

1. A pending LIMIT order must reconcile with its reserved cash/shares before any import. Reservation amounts on a terminal order can remain as historical audit fields even after `reservationReleased=true`; they must not be re-applied to account balances.
2. Historical derivative charge JSON is retained as recorded. Do not recompute historical fills using today's charge schedule.
3. OAuth credentials and ephemeral runtime state are not copied by these fixtures. Reconnect/recreate those records after a separately approved cutover.
4. The source Firebase UID is retained as provenance, but authorization must use a verified Supabase Auth UUID mapping.
5. These fixtures are synthetic and do not prove full production-data parity.

## Verification status

The files were committed to the isolated audit branch and checked through GitHub file retrieval. A successful Node test run or GitHub Actions run has **not** yet been recorded for these new tests. Do not describe this test suite as passing until it has actually been executed in a suitable Node 22 environment.
