import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const json = async path => JSON.parse(await read(path));

test("Equity execution and Market screens share one canonical synthetic instrument, quote and depth", async () => {
  const [market, execution] = await Promise.all([
    json("market-gateway/mock/fixtures/market.json"),
    json("market-gateway/mock/fixtures/equity-execution.json")
  ]);
  const instrument = execution.data.instrument;
  const quote = market.data.quotes.find(item => item.instrumentKey === instrument.instrumentKey);
  assert.ok(quote, "execution instrument must exist in shared market fixture");
  assert.equal(quote.symbol, instrument.symbol);
  assert.equal(quote.lastPricePaise, instrument.markPricePaise);
  assert.equal(market.asOf, execution.asOf);
  assert.equal(market.data.depth.instrumentKey, instrument.instrumentKey);
  assert.deepEqual(market.data.depth.bids, execution.data.orderBook.bids);
  assert.deepEqual(market.data.depth.asks, execution.data.orderBook.asks);
  assert.equal(instrument.instrumentKey, "MOCK|NSE|EQ|0001");
});

test("15-screen Demo mounts the existing canonical Equity engine without a duplicate", async () => {
  const [html, js, panel, engine] = await Promise.all([
    read("markets/stocks/demo.html"),
    read("markets/stocks/demo.js"),
    read("markets/stocks/demo-equity-panel.mjs"),
    read("market-gateway/lib/equity-demo-execution-engine.js")
  ]);
  assert.match(html, /equity-demo-execution-engine\.js/);
  assert.match(js, /from "\.\/demo-equity-panel\.mjs"/);
  assert.match(js, /mountEquityDemo\(content\)/);
  assert.match(js, /appendEquitySummary\(content,name\)/);
  assert.match(panel, /createEquityDemoExecutionEngine/);
  assert.match(panel, /createEquityDemoLedgerBridge/);
  assert.match(panel, /submitOrder/);
  assert.match(panel, /matchNext/);
  assert.match(panel, /cancelOrder/);
  assert.match(panel, /getFillReceipts|snapshot\(\)/);
  assert.match(engine, /EQUITY_DEMO_EXECUTION_DISABLED_IN_PRODUCTION/);
  assert.match(panel, /credentials:"omit"/);
});

test("Equity order, trade, positions and holdings projections remain visibly separate from Wallet", async () => {
  const [js, panel] = await Promise.all([
    read("markets/stocks/demo.js"),
    read("markets/stocks/demo-equity-panel.mjs")
  ]);
  assert.match(js, /appendEquitySummary\(content,name\)/);
  assert.match(panel, /LOCAL EQUITY FILL RECEIPTS/);
  assert.match(panel, /LOCAL DELIVERY HOLDINGS/);
  assert.match(panel, /not reconciled with the Wallet/);
  assert.doesNotMatch(panel, /account\.ledgerReconciled\s*=\s*true/);
  assert.doesNotMatch(js, /appendEquitySummary\(content,"account"\)/);
});

test("PWA caches the simulator and synthetic fixtures; production gateway stays isolated", async () => {
  const [sw, supabaseGateway, legacyGateway, workflow] = await Promise.all([
    read("markets/service-worker.js"),
    read("market-gateway/supabase-server.js"),
    read("market-gateway/server.js"),
    read(".github/workflows/s-trade-fo-demo-ui-integration.yml")
  ]);
  assert.match(sw, /zenura-markets-shell-v8/);
  assert.match(sw, /stocks\/demo-equity-panel\.mjs/);
  assert.match(sw, /stocks\/demo-chart-panel\.mjs/);
  assert.match(sw, /stocks\/demo-chart-data\.mjs/);
  assert.match(sw, /equity-demo-execution-engine\.js/);
  assert.match(sw, /fixtures\/market\.json/);
  assert.match(sw, /fixtures\/equity\.json/);
  assert.match(sw, /fixtures\/derivatives\.json/);
  assert.match(sw, /fixtures\/equity-execution\.json/);
  assert.match(sw, /SHELL\.includes\(url\.toString\(\)\)/);
  assert.match(sw, /if\(shellAsset\|\|/);
  assert.match(sw, /!url\.pathname\.startsWith\(BASE\.pathname\)&&!shellAsset/);
  const productionBoundary = /paper-demo-adapter|derivative-mock-simulator|paper-mock-fixtures|equity-demo-execution-engine|demo-(equity|chart|derivative)-panel|market-gateway\/mock\/fixtures|equity-execution\.json/;
  assert.doesNotMatch(supabaseGateway, productionBoundary);
  assert.doesNotMatch(legacyGateway, productionBoundary);
  assert.match(workflow, /paper-demo-equity-integration\.test\.mjs/);
});
