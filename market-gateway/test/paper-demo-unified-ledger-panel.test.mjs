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
  assert.deepEqual(calculateAggregateUnrealized(positions, marks, now), { complete: true, value: 300 });
  marks.set("FUT1", createPortfolioMark(550, now - 15_001, { now, maxAgeMs: 15_000 }));
  assert.deepEqual(calculateAggregateUnrealized(positions, marks, now), { complete: false, value: null });
  marks.delete("FUT1");
  assert.deepEqual(calculateAggregateUnrealized(positions, marks), { complete: false, value: null });
});

test("Futures notional is not presented as ordinary portfolio market value", async () => {
  const { portfolioMarketValueDisplay, createPortfolioMark } = await import("../../markets/stocks/demo-unified-ledger-panel.mjs");
  const now = 1_800_000_000_000;
  const fresh = createPortfolioMark(2500000, now, { now, maxAgeMs: 15000 });
  assert.equal(portfolioMarketValueDisplay({ assetClass: "FUTURE", quantity: 25 }, fresh), "Not applicable (Futures MTM)");
  assert.equal(portfolioMarketValueDisplay({ assetClass: "OPTION", quantity: 25 }, fresh, now), "₹6,25,000.00");
  assert.equal(portfolioMarketValueDisplay({ assetClass: "EQUITY", quantity: 10 }, null, now), "—");
});

test("account realized P&L includes closed positions no longer present in open positions", async () => {
  const { accountRealizedPnlPaise } = await import("../../markets/stocks/demo-unified-ledger-panel.mjs");
  const snapshot = {
    account: { realizedPnlPaise: 12500 },
    positions: [{ quantity: 2, realizedPnlPaise: 500 }]
  };
  assert.equal(accountRealizedPnlPaise(snapshot), 12500);
  assert.equal(accountRealizedPnlPaise({ account: { realizedPnlPaise: null } }), null);
});


test("Portfolio end-to-end renders fresh MOCK marks for Equity, Futures and Options", async () => {
  const fixedNow = Date.parse("2026-11-25T09:30:00+05:30");
  const iso = new Date(fixedNow).toISOString();
  const [account, equity, derivatives] = await Promise.all([
    read("market-gateway/mock/fixtures/account.json").then(JSON.parse),
    read("market-gateway/mock/fixtures/equity-execution.json").then(JSON.parse),
    read("market-gateway/mock/fixtures/derivatives.json").then(JSON.parse)
  ]);
  equity.asOf = iso;
  derivatives.asOf = iso;
  for (const quote of derivatives.data.quotes) quote.timestamp = iso;

  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this._text = ""; this.className = ""; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(node => node.textContent || "").join(""); }
  }
  const previous = {
    now: Date.now,
    fetch: globalThis.fetch,
    document: globalThis.document
  };
  try {
    Date.now = () => fixedNow;
    globalThis.document = { createElement: tag => new Element(tag) };
    globalThis.fetch = async input => {
      const pathname = new URL(input).pathname;
      const fixture = pathname.endsWith("/account.json") ? account
        : pathname.endsWith("/equity-execution.json") ? equity
        : pathname.endsWith("/derivatives.json") ? derivatives : null;
      return { ok: Boolean(fixture), json: async () => structuredClone(fixture) };
    };

    const { getSharedPaperDemoLedgerSession } = await import("../../markets/shared/paper-demo-ledger-session.mjs");
    const session = getSharedPaperDemoLedgerSession({
      accountId: account.data.accountId,
      cashBalancePaise: account.data.cashBalancePaise,
      blockedFundsPaise: account.data.blockedFundsPaise
    });
    const appendPosition = (engine, assetClass, instrumentKey, quantity, averagePricePaise, suffix) => {
      session.ledger.append({
        eventId: "portfolio-e2e-event-" + suffix,
        idempotencyKey: "portfolio-e2e-idem-" + suffix,
        sourceEventId: "portfolio-e2e-source-" + suffix,
        accountId: account.data.accountId,
        sessionId: session.sessionId,
        occurredAt: iso,
        engine,
        type: "POSITION_CHANGED",
        payload: {
          assetClass, instrumentKey, product: "DELIVERY",
          quantityDelta: quantity,
          costBasisDeltaPaise: quantity * averagePricePaise,
          realizedPnlDeltaPaise: 0
        },
        deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 }
      });
    };
    appendPosition("EQUITY", "EQUITY", equity.data.instrument.instrumentKey, 2, 125000, "eq");
    appendPosition("FUTURES", "FUTURE", derivatives.data.futures.instrumentKey, 25, 2500000, "future");
    appendPosition("OPTIONS", "OPTION", derivatives.data.options.instrumentKey, 25, 15000, "option");

    const { appendUnifiedLedgerSummary } = await import("../../markets/stocks/demo-unified-ledger-panel.mjs?fresh-portfolio-e2e");
    const portfolio = new Element("main");
    await appendUnifiedLedgerSummary(portfolio, "portfolio");
    const portfolioText = portfolio.textContent;
    assert.match(portfolioText, /MOCKALPHA/);
    assert.match(portfolioText, /MOCKNIFTY-FUT-DEC26/);
    assert.match(portfolioText, /MOCKNIFTY-25000-CE-26NOV/);
    assert.match(portfolioText, /Not applicable \(Futures MTM\)/);
    assert.match(portfolioText, /Aggregate unrealized P&L: ₹1\.00/);
    assert.doesNotMatch(portfolioText, /Unavailable \(one or more marks missing\/stale\)/);

    const holdings = new Element("main");
    await appendUnifiedLedgerSummary(holdings, "holdings");
    assert.match(holdings.textContent, /MOCKALPHA/);
    assert.doesNotMatch(holdings.textContent, /MOCKNIFTY-FUT-DEC26|MOCKNIFTY-25000-CE-26NOV/);
  } finally {
    Date.now = previous.now;
    if (previous.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = previous.fetch;
    if (previous.document === undefined) delete globalThis.document; else globalThis.document = previous.document;
  }
});


test("cached Equity and derivative marks expire against advancing runtime time", async () => {
  const {
    createPortfolioMark, isUsablePortfolioMark, calculateAggregateUnrealized,
    EQUITY_MARK_MAX_AGE_MS, DERIVATIVE_MARK_MAX_AGE_MS
  } = await import("../../markets/stocks/demo-unified-ledger-panel.mjs?runtime-mark-expiry");
  const now = 1_800_000_000_000;
  const equity = createPortfolioMark(12500, now, { now, maxAgeMs: EQUITY_MARK_MAX_AGE_MS });
  const derivative = createPortfolioMark(25000, now, { now, maxAgeMs: DERIVATIVE_MARK_MAX_AGE_MS });
  assert.equal(isUsablePortfolioMark(equity, now), true);
  assert.equal(isUsablePortfolioMark(equity, now + EQUITY_MARK_MAX_AGE_MS), true);
  assert.equal(isUsablePortfolioMark(equity, now + EQUITY_MARK_MAX_AGE_MS + 1), false);
  assert.equal(isUsablePortfolioMark(derivative, now + DERIVATIVE_MARK_MAX_AGE_MS), true);
  assert.equal(isUsablePortfolioMark(derivative, now + DERIVATIVE_MARK_MAX_AGE_MS + 1), false);
  const positions = [
    { instrumentKey: "EQ-EXPIRY", quantity: 2, averagePricePaise: 10000 },
    { instrumentKey: "FUT-EXPIRY", quantity: -1, averagePricePaise: 25000 }
  ];
  const marks = new Map([
    ["EQ-EXPIRY", equity],
    ["FUT-EXPIRY", derivative]
  ]);
  assert.deepEqual(calculateAggregateUnrealized(positions, marks, now), { complete: true, value: 5000 });
  assert.deepEqual(calculateAggregateUnrealized(positions, marks, now + DERIVATIVE_MARK_MAX_AGE_MS + 1),
    { complete: false, value: null });
  assert.deepEqual(calculateAggregateUnrealized(positions, marks, now + EQUITY_MARK_MAX_AGE_MS + 1),
    { complete: false, value: null });
});

test("runtime mark validation rejects newly future-dated timestamps beyond allowed skew", async () => {
  const { createPortfolioMark, isUsablePortfolioMark, EQUITY_MARK_MAX_FUTURE_SKEW_MS } =
    await import("../../markets/stocks/demo-unified-ledger-panel.mjs?runtime-future-skew");
  const now = 1_800_000_000_000;
  const mark = createPortfolioMark(100, now + EQUITY_MARK_MAX_FUTURE_SKEW_MS,
    { now, maxAgeMs: 60_000, maxFutureSkewMs: EQUITY_MARK_MAX_FUTURE_SKEW_MS });
  assert.equal(isUsablePortfolioMark(mark, now), true);
  assert.equal(isUsablePortfolioMark(mark, now - 1), false);
  assert.equal(isUsablePortfolioMark(mark, now - 1_001), false);
});
