# S-TRADE Chart Demo — Shared MOCK Identity Alignment

Date: 2026-11-24

## What changed
- The chart workspace remains a read-only deterministic synthetic demo.
- Instrument keys now use the canonical `MOCK|` namespace rather than a separate `DEMO|` namespace.
- Symbols now use `MOCK...` identifiers and fictional names; no real NSE/BSE instrument symbols are used.
- The fixture remains a versioned v1.0.0 envelope with `mode=MOCK`, `simulated=true`, `meta.source=SYNTHETIC_FIXTURE`, and `meta.exchange=NONE`. NONE is intentional: these demo chart instruments are not exchange-tradable.
- The chart adapter validates every instrument key, symbol and integer paise base price before producing any candles.
- The deterministic OHLCV generator, fixed anchor timestamp, selectable 1m/5m/15m/1h/1D/1W/1M timeframes, line/candlestick display and five-level synthetic depth remain unchanged.
- CI now runs chart module syntax checks and deterministic fixture tests alongside the shared contract and dashboard tests.

## Safety boundaries
- No quote or candle from this fixture may be passed to authenticated live chart, order, margin, valuation, portfolio or P&L flows.
- No order execution, provider API, Upstox credential, database write, worker or Crypto path is connected.
- Existing authenticated KLineChart and Upstox data path remains separate.
- This aligns chart identity and envelope metadata with the shared MOCK conventions; it does not yet make the chart fixture a consumer of the canonical PR #137 market quote payload. A follow-up adapter can do that once the canonical chart series/depth payload is defined.

## Verification
Exact-head CI is required for this PR. Full PostgreSQL/RLS and browser/mobile tests remain independent gates.
