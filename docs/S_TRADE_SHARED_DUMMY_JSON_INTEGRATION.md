# S-TRADE shared Dummy JSON integration — canonical ownership

Status: integration coordination for PRs #137, #145, #147 and #150.

## Canonical source of truth

- **Contracts and fixtures:** PR #137 — `market-gateway/mock/contracts/` and `market-gateway/mock/fixtures/`.
- **Browser-safe read-only adapter:** PR #145 — `markets/shared/paper-demo-adapter.mjs`. This is the single consumer adapter. It requires explicit demo opt-in, rejects production mode and non-MOCK identities, and preserves integer-paise values and `ledgerReconciled: false`.
- **Active demo workspace:** PR #150 — `/markets/stocks/demo.html`, all 15 screens, using the canonical fixture envelopes through the shared adapter.
- **Legacy dashboard URL:** `/markets/dashboard/` is retained as a compatibility redirect to `/markets/stocks/demo.html`. Its former independent `mock-data.json` model is not an active data source.

## PR audit and disposition

| PR | Role | Disposition |
|---|---|---|
| #137 | Versioned envelope/domain schemas and deterministic fixture loader | Canonical contract foundation; retain |
| #145 | Pure browser consumer adapter | Canonical adapter; retain and reuse |
| #147 | Separate dashboard fixture/model and UI | Superseded by the single 15-screen demo route; preserve its PR and history, but do not merge its duplicate fixture/model |
| #150 | Canonical 15-screen read-only demo route | Active screen integration foundation |

Do not delete branches, rewrite history, or close a superseded PR merely to hide it. Mark the PR title/body as superseded and link the replacement so the audit trail remains visible.

## Production boundary

The browser demo route must not import the fixture loader or browser adapter into `market-gateway/server.js` or `market-gateway/supabase-server.js`. It must not call authenticated production order, account, watchlist, quote, worker, ledger or broker routes. Production routes remain on their existing authenticated/provider-backed paths. No live fallback is permitted.

The demo is read-only and synthetic. Missing OHLC, private watchlists, cross-asset positions, holdings or ledger-reconciled totals must be shown as unavailable/empty rather than inferred or fabricated. Keep `ledgerReconciled: false`.

## Verification gates

- Parse all canonical fixture JSON and validate against the versioned schemas.
- Run fixture-loader, adapter, all-screen and legacy-route alias tests.
- Assert production gateway files do not import the demo adapter/fixture loader.
- Run exact-head GitHub Actions and the repository's full checks before review.
- Browser/mobile QA remains a separate gate. No merge, production activation, migration or deployment is implied by this integration PR.
