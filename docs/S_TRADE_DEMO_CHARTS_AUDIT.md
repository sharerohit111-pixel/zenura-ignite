# S-TRADE Charts & Depth — Shared MOCK Integration Audit

Date: 2026-11-24

## Audit outcome

- PR #139 introduced the first isolated deterministic chart/depth demo and its own chart fixture.
- PR #151 aligned that fixture's identifiers to the MOCK namespace, but still retained a separate chart-only instrument master.
- Draft PR #155 supersedes the chart-only data path: it consumes the canonical PR #137 shared MOCK envelopes through the browser-safe PR #145 adapter. The standalone `markets/stocks/demo-market-data.json` fixture and superseded classic chart scripts are removed.
- Existing authenticated chart behavior remains owned by `markets/stocks/chart-engine.js` and `markets/stocks/stocks.js`; this demo is a separate read-only panel.

## Shared data flow

1. The chart workspace loads the shared `market.json`, `account.json`, `equity.json` and `derivatives.json` envelopes from `market-gateway/mock/fixtures/`.
2. `markets/shared/paper-demo-adapter.mjs` validates the envelope, MOCK instrument identities, provider markers, account snapshot and derivative payloads. The chart integration does not create a second instrument master.
3. `markets/stocks/demo-chart-data.mjs` maps the adapter's shared equity quotes and derivative fixture contracts into chart-selectable MOCK instruments.
4. OHLCV bars are generated deterministically from the instrument key, timeframe and fixed shared fixture timestamp. Supported intervals: 1m, 5m, 15m, 1h, 1D, 1W and 1M.
5. Five illustrative bid/ask levels are derived deterministically from the shared fixture's depth when available, or from the synthetic instrument reference price otherwise. These levels are not executable liquidity.

## Chart presentation

- Candlestick and line chart modes, volume bars, OHLC summary, instrument selector, timeframe selector, fixed snapshot timestamp and five-level bid/ask depth.
- Visible identity: **MOCK · DEMO DATA · NOT LIVE NSE/BSE**.
- Synthetic-only instrument symbols and keys use the MOCK namespace.
- All demo outputs are read-only and do not submit orders.

## Safety boundaries

- Explicit non-production opt-in is required by the shared adapter; production mode fails closed.
- The demo chart model is not connected to authenticated Upstox candles, live quotes, watchlist quotes, order execution, valuation, margin, portfolio or P&L.
- Existing live KLineChart/Upstox path remains separate and is not relabelled as MOCK.
- No fixture loader is imported by production gateway routes.
- No Crypto, database migration, worker, broker or exchange integration is added.

## Verification

- `market-gateway/test/demo-chart-data.test.mjs` covers shared adapter consumption, explicit opt-in, rejection of non-MOCK symbols, deterministic OHLCV, all timeframes, OHLC invariants, depth ordering and fail-closed inputs.
- The dedicated Mock Contract workflow syntax-checks both chart modules and runs the chart integration tests.
- On exact PR head `f7379f24258673bd844197febbf47d9f7325e0de`, the dedicated Mock Contract workflow completed successfully: shared JSON schemas/fixtures, adapter tests, chart module syntax, all five chart integration tests, and production fixture isolation passed.
- On the same exact PR head, the Supabase/PostgreSQL migration smoke and full market-gateway regression workflow completed successfully (71 workflow steps successful; no failed steps).
- Browser/mobile E2E remains a separate release gate and has not been run/verified in this audit.

## Supersession

PR #155 is stacked on PR #151 and is the integration candidate. Do not merge PR #139 or PR #151 independently; their earlier chart-only fixture implementations are retained as review history.
