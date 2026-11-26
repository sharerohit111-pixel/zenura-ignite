import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createChartDemoModel, createDemoCandles, createDemoDepth, INTERVALS } from "../../markets/stocks/demo-chart-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../market-gateway/mock/fixtures");
const names = ["market","account","equity","derivatives"];
const fixtures = Object.fromEntries(names.map(name => [name, JSON.parse(fs.readFileSync(path.join(root,name+".json"),"utf8"))]));
const options = { enabled: true, production: false };

test("chart model consumes canonical shared MOCK fixtures through the shared adapter", () => {
  const model = createChartDemoModel(fixtures, options);
  assert.equal(model.identity.mode, "MOCK");
  assert.equal(model.identity.provider, "DUMMY_JSON");
  const canonicalKeys = [
    ...fixtures.market.data.quotes.map(item => item.instrumentKey),
    ...fixtures.derivatives.data.contracts.map(item => item.instrumentKey)
  ];
  assert.deepEqual(model.instruments.map(item => item.instrumentKey), canonicalKeys);
  assert.ok(model.instruments.every(item => item.instrumentKey.startsWith("MOCK|") && item.symbol.startsWith("MOCK")));
  assert.ok(model.instruments.some(item => item.assetClass === "FUTURE"));
  assert.ok(model.instruments.some(item => item.assetClass === "OPTION"));
  assert.ok(!model.instruments.some(item => ["MOCK|NSE|FUT|0001", "MOCK|NSE|OPT|0001"].includes(item.instrumentKey)),
    "order fixture identities must not create non-catalog chart instruments");
});

test("chart adapter requires explicit non-production opt-in and rejects real identities", () => {
  assert.throws(() => createChartDemoModel(fixtures), /PAPER_DEMO_NOT_EXPLICITLY_ENABLED/);
  assert.throws(() => createChartDemoModel(fixtures, { enabled: true, production: true }), /PAPER_DEMO_DISABLED_IN_PRODUCTION/);
  const invalid = structuredClone(fixtures);
  invalid.market.data.quotes[0].symbol = "RELIANCE";
  assert.throws(() => createChartDemoModel(invalid, options), /NON_SYNTHETIC_INSTRUMENT_SYMBOL/);
});

test("all supported timeframes produce deterministic, ordered OHLCV candles", () => {
  const model = createChartDemoModel(fixtures, options);
  const instrument = model.instruments[0];
  for (const timeframe of Object.keys(INTERVALS)) {
    const bars = createDemoCandles(instrument, timeframe, 40, model.asOf);
    assert.deepEqual(bars, createDemoCandles(instrument, timeframe, 40, model.asOf));
    assert.equal(bars.length, 40);
    for (let i=0; i<bars.length; i++) {
      const bar = bars[i];
      assert.ok(bar.high >= Math.max(bar.open,bar.close));
      assert.ok(bar.low <= Math.min(bar.open,bar.close));
      assert.ok(bar.volume >= 500);
      if (i) assert.ok(bar.timestamp > bars[i-1].timestamp);
    }
  }
});

test("depth is shown only for the exact canonical instrument with fixture-provided levels", () => {
  const model = createChartDemoModel(fixtures, options);
  const depthInstrument = model.instruments.find(item => item.instrumentKey === fixtures.market.data.depth.instrumentKey);
  assert.ok(depthInstrument);
  const depth = createDemoDepth(depthInstrument, model);
  assert.equal(depth.bids.length, fixtures.market.data.depth.bids.length);
  assert.equal(depth.asks.length, fixtures.market.data.depth.asks.length);
  assert.deepEqual(depth.bids.map(level => level.price), fixtures.market.data.depth.bids.map(level => level.pricePaise / 100));
  assert.deepEqual(depth.asks.map(level => level.price), fixtures.market.data.depth.asks.map(level => level.pricePaise / 100));
  assert.ok(depth.bids[0].price < depth.asks[0].price);
  assert.deepEqual(depth, createDemoDepth(depthInstrument, model));
  for (const instrument of model.instruments.filter(item => item.instrumentKey !== depthInstrument.instrumentKey)) {
    assert.equal(createDemoDepth(instrument, model), null, "must not synthesize depth for " + instrument.instrumentKey);
  }
  const noMatch = { ...model, depth: { ...model.depth, instrumentKey: "MOCK|NSE|EQ|UNKNOWN" } };
  assert.equal(createDemoDepth(depthInstrument, noMatch), null);
});

test("invalid instrument, timeframe, candle count and snapshot fail closed", () => {
  const model = createChartDemoModel(fixtures, options);
  assert.throws(() => createDemoCandles({}, "5m"), /INVALID_SYNTHETIC_CHART_INSTRUMENT/);
  assert.throws(() => createDemoCandles(model.instruments[0], "2m"), /UNSUPPORTED_DEMO_TIMEFRAME/);
  assert.throws(() => createDemoCandles(model.instruments[0], "1m", 501), /INVALID_DEMO_CANDLE_COUNT/);
  assert.throws(() => createDemoCandles(model.instruments[0], "1m", 10, "bad-date"), /INVALID_MOCK_SNAPSHOT_TIMESTAMP/);
});
