import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("Trade History, Orders, Portfolio, Positions and Holdings route through one unified ledger projection", async () => {
  const js = await read("markets/stocks/demo.js");
  const panel = await read("markets/stocks/demo-unified-ledger-panel.mjs");
  assert.match(js, /appendUnifiedLedgerSummary\(content,name\)/);
  assert.match(js, /demo-unified-ledger-panel\.mjs/);
  for (const screen of ["orders","trades","portfolio","positions","holdings"]) {
    assert.ok(js.includes('name==="'+screen+'"'), "route "+screen+" to the shared projection");
  }
  assert.match(panel, /snapshot\.fills/);
  assert.match(panel, /snapshot\.orders/);
  assert.match(panel, /snapshot\.positions/);
  assert.match(panel, /getSharedPaperDemoLedgerSession/);
  assert.match(panel, /assetClass/);
  assert.match(panel, /positions/);
  assert.match(panel, /realizedPnlPaise/);
  assert.match(panel, /unrealized/);
  assert.match(panel, /ledgerReconciled/);
});

test("PWA precaches the unified panel and retains the single shared ledger session", async () => {
  const sw = await read("markets/service-worker.js");
  const panel = await read("markets/stocks/demo-unified-ledger-panel.mjs");
  assert.match(sw, /stocks\/demo-unified-ledger-panel\.mjs/);
  assert.match(sw, /shared\/paper-demo-ledger-session\.mjs/);
  assert.match(panel, /market-gateway\/mock\/fixtures\/account\.json/);
  assert.match(panel, /market-gateway\/mock\/fixtures\/derivatives\.json/);
});
