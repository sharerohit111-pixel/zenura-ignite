"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../../markets/stocks");
const html = fs.readFileSync(path.join(root, "demo.html"), "utf8");
const js = fs.readFileSync(path.join(root, "demo.js"), "utf8");
const adapter = fs.readFileSync(path.join(root, "mock-demo-adapter.js"), "utf8");
const screens = ["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"];

test("demo entry page loads only the isolated dashboard scripts", () => {
  assert.match(html, /mock-demo-adapter\.js/);
  assert.match(html, /demo\.js/);
  assert.match(html, /DEMO DATA · SYNTHETIC FIXTURES/);
  assert.doesNotMatch(html, /connect\.js|email-auth\.js|stocks\.js|order-workspace\.js/);
});

test("all requested Indian-market demo screens are navigable", () => {
  for (const screen of screens) {
    assert.match(html, new RegExp('data-screen="' + screen + '"'));
    assert.match(adapter, new RegExp(screen + ':'));
  }
});

test("dashboard requires explicit mock opt-in and shows read-only safeguards", () => {
  assert.match(js, /createDemoClient\(\{allowDemo:true\}\)/);
  assert.match(js, /READ ONLY · MOCK/);
  assert.match(js, /No exchange\/broker order is invoked/);
  assert.match(js, /ledgerReconciled/);
  assert.match(adapter, /canSubmitOrders: false/);
  assert.match(adapter, /MOCK_DEMO_ORDER_SUBMISSION_DISABLED/);
});

test("demo dashboard does not call production order or account mutation endpoints", () => {
  assert.doesNotMatch(js, /fetch\s*\(/);
  assert.doesNotMatch(js, /\/orders|\/watchlist|\/portfolio\/|submitOrder/i);
});
