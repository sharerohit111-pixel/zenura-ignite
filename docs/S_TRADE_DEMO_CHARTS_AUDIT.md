# S-TRADE Charts and Simulated Quotes Audit

Date: 2026-11-24
Scope: Indian Market Paper Trading (NSE/BSE UI); synthetic demo only.

## Existing chart/data path audited

- `markets/stocks/chart-engine.js` already owns the KLineChart 10.1.1 adapter, chart lifecycle, interval mapping, candle normalization, volume indicator, chart preferences, drawings and live-bar aggregation.
- Historical bars are requested through the authenticated Upstox gateway after the user's own authorization. Live ticks are validated and passed into the existing chart adapter.
- `markets/stocks/live-quote.js` validates quote price and timestamp age before a live quote can be accepted.
- `markets/stocks/stocks.js` owns the authenticated instrument selection, candle loading and quote/feed connection lifecycle.
- The existing shared market fixture has a couple of synthetic quotes and a shallow bid/ask example, but it did not provide a full deterministic OHLCV series, chart-type demo, timeframe interaction or multi-level depth presentation.
- Existing live chart UI and provider path remain unchanged. The new demo is an additional, visibly separated workspace, not a fallback for an unavailable Upstox connection.

## Demo implementation

- `markets/stocks/demo-market-data.json` is a fixed JSON fixture with `mode=MOCK`, `simulated=true`, `meta.source=SYNTHETIC_FIXTURE` and `meta.exchange=NONE`.
- Instruments use explicit `DEMO|` keys and `DEMO-` symbols. They are not NSE/BSE securities.
- `demo-chart-data.js` deterministically derives OHLCV candles from the instrument key, timeframe and fixed anchor timestamp. Supported intervals: 1m, 5m, 15m, 1h, 1D, 1W and 1M.
- `demo-chart-workspace.js` displays candlestick/line modes, volume, OHLC summary, bar timestamp, fixed fixture snapshot timestamp and five synthetic bid/ask levels.
- The panel carries the explicit label **DEMO DATA · NOT NSE LIVE DATA** and a written disclaimer that quantities are not executable liquidity.
- All demo output is read-only; it has no order submission or broker integration.

## Boundaries and release notes

- No live market API, Upstox credentials, provider adapter, exchange websocket, order route, paper ledger, production fallback or Crypto path is added or modified.
- Do not reuse the demo prices/depth for paper order execution, valuation, margin, P&L or watchlist live quotes.
- Existing KLineChart provider data remains the only source for the authenticated live chart; the demo generator is UI-only.
- The JSON snapshot timestamp is fixed fixture metadata, not the current time or a live quote receipt timestamp.

## Tests

`market-gateway/test/demo-chart-data.test.js` verifies explicit synthetic provenance, deterministic output, OHLC invariants, ordered timestamps, all timeframe mappings, depth ordering and fail-closed invalid inputs.
