"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createDemoClient, DEMO_LABEL } = require("../../markets/stocks/mock-demo-adapter");

const fixtureRoot = path.join(__dirname, "../mock/fixtures");
function fixtureFetch(url, options) {
  assert.equal(options.credentials, "omit");
  assert.equal(options.cache, "no-store");
  const filename = path.basename(url);
  return Promise.resolve({
    ok: true,
    json: async () => JSON.parse(fs.readFileSync(path.join(fixtureRoot, filename), "utf8"))
  });
}

test("demo client requires explicit opt-in before reading any fixture", () => {
  assert.throws(() => createDemoClient({ fetchImpl: fixtureFetch }), /EXPLICIT_OPT_IN/);
});

test("screen adapter maps supported Indian market screens to shared fixture envelopes", async () => {
  const client = createDemoClient({ allowDemo: true, fetchImpl: fixtureFetch });
  for (const screen of ["home", "market", "watchlists", "charts", "account", "profile",
    "settings", "equity", "orders", "trades", "portfolio", "positions", "holdings",
    "futures", "options"]) {
    const result = await client.readScreen(screen);
    assert.equal(result.screen, screen);
    assert.equal(result.label, DEMO_LABEL);
    assert.equal(result.envelope.mode, "MOCK");
    assert.equal(result.envelope.simulated, true);
    assert.equal(result.canSubmitOrders, false);
  }
});

test("market and account screens expose deterministic synthetic fixtures", async () => {
  const client = createDemoClient({ allowDemo: true, fetchImpl: fixtureFetch });
  const market = await client.readScreen("market");
  const account = await client.readScreen("account");
  assert.equal(market.envelope.data.quotes[0].symbol, "MOCKALPHA");
  assert.equal(account.envelope.data.startingCapitalPaise, 100000000);
  assert.equal(account.envelope.data.ledgerReconciled, false);
});

test("cached fixture results are detached so consumers cannot mutate shared data", async () => {
  const client = createDemoClient({ allowDemo: true, fetchImpl: fixtureFetch });
  const first = await client.readFixture("market");
  first.data.quotes[0].symbol = "ALTERED";
  const second = await client.readFixture("market");
  assert.equal(second.data.quotes[0].symbol, "MOCKALPHA");
});

test("unknown fixture and screen names fail closed", async () => {
  const client = createDemoClient({ allowDemo: true, fetchImpl: fixtureFetch });
  await assert.rejects(client.readFixture("crypto"), /UNKNOWN_MOCK_FIXTURE/);
  await assert.rejects(client.readScreen("crypto"), /UNKNOWN_MOCK_SCREEN/);
});

test("mock demo mode never permits order submission", () => {
  const client = createDemoClient({ allowDemo: true, fetchImpl: fixtureFetch });
  assert.equal(client.canSubmitOrders, false);
  assert.throws(() => client.assertOrderSubmissionDisabled(), /MOCK_DEMO_ORDER_SUBMISSION_DISABLED/);
});

test("malformed or non-synthetic envelopes are rejected", async () => {
  const badFetch = async () => ({ ok: true, json: async () => ({
    schemaVersion: "1.0.0", mode: "PAPER", simulated: true,
    requestId: "bad", asOf: "2026-11-24T09:30:00+05:30",
    meta: { source: "PAPER_LEDGER" }, data: {}
  }) });
  const client = createDemoClient({ allowDemo: true, fetchImpl: badFetch });
  await assert.rejects(client.readFixture("market"), /INVALID_MOCK_FIXTURE_ENVELOPE/);
});
