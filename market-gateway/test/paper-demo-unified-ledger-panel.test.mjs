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

test("Portfolio marks enforce existing asset-specific freshness limits", async () => {
  const { createPortfolioMark, EQUITY_MARK_MAX_AGE_MS, DERIVATIVE_MARK_MAX_AGE_MS,
    EQUITY_MARK_MAX_FUTURE_SKEW_MS } = await import("../../markets/stocks/demo-unified-ledger-panel.mjs");
  const now = 1_800_000_000_000;
  const iso = ms => new Date(ms).toISOString();
  assert.equal(EQUITY_MARK_MAX_AGE_MS, 60_000);
  assert.equal(DERIVATIVE_MARK_MAX_AGE_MS, 15_000);
  assert.equal(EQUITY_MARK_MAX_FUTURE_SKEW_MS, 5_000);
  assert.equal(createPortfolioMark(100, iso(now - 60_000), { now, maxAgeMs: EQUITY_MARK_MAX_AGE_MS, maxFutureSkewMs: 5_000 }).stale, false);
  assert.equal(createPortfolioMark(100, iso(now - 60_001), { now, maxAgeMs: EQUITY_MARK_MAX_AGE_MS, maxFutureSkewMs: 5_000 }).stale, true);
  assert.equal(createPortfolioMark(100, iso(now - 15_000), { now, maxAgeMs: DERIVATIVE_MARK_MAX_AGE_MS }).stale, false);
  assert.equal(createPortfolioMark(100, iso(now - 15_001), { now, maxAgeMs: DERIVATIVE_MARK_MAX_AGE_MS }).stale, true);
  assert.equal(createPortfolioMark(100, iso(now + 5_000), { now, maxAgeMs: EQUITY_MARK_MAX_AGE_MS, maxFutureSkewMs: 5_000 }).stale, false);
  assert.equal(createPortfolioMark(100, iso(now + 5_001), { now, maxAgeMs: EQUITY_MARK_MAX_AGE_MS, maxFutureSkewMs: 5_000 }).stale, true);
  assert.equal(createPortfolioMark(100, iso(now + 1), { now, maxAgeMs: DERIVATIVE_MARK_MAX_AGE_MS }).stale, true);
  assert.equal(createPortfolioMark(100, iso(now), { now, maxAgeMs: 60_000, explicitStale: true }).stale, true);
  assert.equal(createPortfolioMark(100, "invalid", { now, maxAgeMs: 60_000 }).stale, true);
  assert.equal(createPortfolioMark(0, iso(now), { now, maxAgeMs: 60_000 }).stale, true);
});

test("aggregate unrealized P&L is withheld when any open position lacks a fresh valid mark", async () => {
  const { createPortfolioMark, calculateAggregateUnrealized } = await import("../../markets/stocks/demo-unified-ledger-panel.mjs");
  const now = 1_800_000_000_000;
  const positions = [
    { instrumentKey: "EQ1", quantity: 10, averagePricePaise: 100 },
    { instrumentKey: "FUT1", quantity: 2, averagePricePaise: 500 }
  ];
  const marks = new Map([
    ["EQ1", createPortfolioMark(120, now, { now, maxAgeMs: 60_000 })],
    ["FUT1", createPortfolioMark(550, now, { now, maxAgeMs: 15_000 })]
  ]);
  assert.deepEqual(calculateAggregateUnrealized(positions, marks), { complete: true, value: 300 });
  marks.set("FUT1", createPortfolioMark(550, now - 15_001, { now, maxAgeMs: 15_000 }));
  assert.deepEqual(calculateAggregateUnrealized(positions, marks), { complete: false, value: null });
  marks.delete("FUT1");
  assert.deepEqual(calculateAggregateUnrealized(positions, marks), { complete: false, value: null });
});
