import { createPaperDemoViewModel, isPaperDemoViewModel } from "../shared/paper-demo-adapter.mjs";

export const INTERVALS = Object.freeze({
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000,
  "1D": 86_400_000, "1W": 604_800_000, "1M": 2_592_000_000
});

function fail(code) { throw new TypeError(code); }
function hash(value) {
  let h = 2166136261;
  for (const char of String(value)) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function assertInstrument(item) {
  if (!item || typeof item.instrumentKey !== "string" || !item.instrumentKey.startsWith("MOCK|") ||
      typeof item.symbol !== "string" || !/^MOCK[A-Z0-9-]*$/.test(item.symbol) ||
      !Number.isSafeInteger(item.basePricePaise) || item.basePricePaise <= 0) {
    fail("INVALID_SYNTHETIC_CHART_INSTRUMENT");
  }
  return Object.freeze({ ...item, seed: Number.isSafeInteger(item.seed) ? item.seed : hash(item.instrumentKey) });
}

/** Load chart instruments only through the canonical shared DUMMY_JSON adapter. */
export function createChartDemoModel(fixtures, options = {}) {
  const viewModel = createPaperDemoViewModel(fixtures, options);
  if (!isPaperDemoViewModel(viewModel)) fail("PAPER_DEMO_VIEW_MODEL_REQUIRED");
  const instruments = new Map();
  for (const item of viewModel.market.instruments) {
    instruments.set(item.instrumentKey, assertInstrument({
      instrumentKey: item.instrumentKey, symbol: item.symbol, name: item.symbol,
      assetClass: item.assetClass, exchange: item.exchange, basePricePaise: item.lastPricePaise,
      changePaise: item.changePaise, timestamp: item.timestamp, seed: hash(item.instrumentKey)
    }));
  }
  const future = viewModel.derivatives.futures;
  const futurePrice = future.order.limitPricePaise ?? future.order.averagePricePaise;
  if (Number.isSafeInteger(futurePrice) && futurePrice > 0) {
    instruments.set(future.instrumentKey, assertInstrument({
      instrumentKey: future.instrumentKey, symbol: future.symbol, name: future.symbol,
      assetClass: "FUTURE", exchange: future.instrumentKey.split("|")[1],
      basePricePaise: futurePrice, expiry: future.expiry, seed: hash(future.instrumentKey)
    }));
  }
  const option = viewModel.derivatives.options;
  const optionPrice = option.order.averagePricePaise ?? option.order.limitPricePaise;
  if (Number.isSafeInteger(optionPrice) && optionPrice > 0) {
    const symbol = option.underlying + "-" + option.optionType;
    instruments.set(option.instrumentKey, assertInstrument({
      instrumentKey: option.instrumentKey, symbol, name: symbol + " " + option.strikePaise / 100,
      assetClass: "OPTION", exchange: option.instrumentKey.split("|")[1],
      basePricePaise: optionPrice, expiry: option.expiry, strikePaise: option.strikePaise,
      optionType: option.optionType, seed: hash(option.instrumentKey)
    }));
  }
  if (!instruments.size) fail("MOCK_CHART_INSTRUMENTS_REQUIRED");
  return Object.freeze({
    identity: Object.freeze({ mode: "MOCK", provider: "DUMMY_JSON", simulated: true,
      schemaVersion: "1.0.0", source: "SYNTHETIC_FIXTURE", exchange: "NONE",
      label: "MOCK · DEMO DATA — NOT LIVE NSE/BSE DATA" }),
    asOf: viewModel.asOf,
    instruments: Object.freeze([...instruments.values()]),
    depth: viewModel.market.depth
  });
}

export function createDemoCandles(instrument, timeframe = "5m", count = 64, asOf = "2026-11-24T09:30:00+05:30") {
  assertInstrument(instrument);
  const interval = INTERVALS[timeframe];
  if (!interval) throw new RangeError("UNSUPPORTED_DEMO_TIMEFRAME");
  if (!Number.isInteger(count) || count < 2 || count > 500) throw new RangeError("INVALID_DEMO_CANDLE_COUNT");
  const anchor = Date.parse(asOf);
  if (!Number.isFinite(anchor)) fail("INVALID_MOCK_SNAPSHOT_TIMESTAMP");
  let state = (hash(instrument.instrumentKey + "|" + timeframe) + instrument.seed) >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const bars = [];
  let previous = instrument.basePricePaise;
  const end = Math.floor(anchor / interval) * interval;
  for (let i = count - 1; i >= 0; i--) {
    const open = previous;
    const close = Math.max(1, Math.round(open * (1 + (random() - 0.49) * 0.0035)));
    const spread = Math.max(1, Math.round(open * (0.0005 + random() * 0.0012)));
    const high = Math.max(open, close) + Math.round(spread * random());
    const low = Math.max(1, Math.min(open, close) - Math.round(spread * random()));
    bars.push(Object.freeze({ timestamp: end - i * interval, open: open / 100, high: high / 100,
      low: low / 100, close: close / 100, volume: Math.round(500 + random() * 9500) }));
    previous = close;
  }
  return bars;
}

/** Five-level illustrative depth expanded deterministically from shared MOCK depth. */
export function createDemoDepth(instrument, model) {
  assertInstrument(instrument);
  if (!model || model.identity?.mode !== "MOCK" || !model.depth ||
      !Array.isArray(model.depth.bids) || !Array.isArray(model.depth.asks)) fail("INVALID_MOCK_CHART_DEPTH");
  const matched = model.depth.instrumentKey === instrument.instrumentKey;
  const bestBid = matched && model.depth.bids[0]?.pricePaise || Math.max(1, instrument.basePricePaise - Math.max(1, Math.round(instrument.basePricePaise * 4 / 10000)));
  const bestAsk = matched && model.depth.asks[0]?.pricePaise || instrument.basePricePaise + Math.max(1, Math.round(instrument.basePricePaise * 4 / 10000));
  const step = Math.max(1, Math.round(instrument.basePricePaise * 2 / 10000));
  const bidQty = matched ? model.depth.bids[0]?.quantity || 100 : 100;
  const askQty = matched ? model.depth.asks[0]?.quantity || 100 : 100;
  const bids = Array.from({ length: 5 }, (_, i) => Object.freeze({
    price: Math.max(1, bestBid - i * step) / 100, quantity: Math.max(1, Math.round(bidQty * (1 - i * 0.13)))
  }));
  const asks = Array.from({ length: 5 }, (_, i) => Object.freeze({
    price: (bestAsk + i * step) / 100, quantity: Math.max(1, Math.round(askQty * (1 - i * 0.13)))
  }));
  return Object.freeze({ bids: Object.freeze(bids), asks: Object.freeze(asks), simulated: true });
}
