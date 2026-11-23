"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractUpstoxExecutableQuote,
  evaluateUpstoxDerivativeLimit,
} = require("../lib/upstox-executable-quote");

const NOW = 1_800_000_000_000;
const KEY = "NSE_FO|NIFTY26NOVFUT";
function response(depth = {}) {
  return {
    currentTs: String(NOW - 1000),
    feeds: {
      [KEY]: {
        fullFeed: {
          marketFF: {
            marketLevel: { bidAskQuote: [{
              bidP: 201.25, bidQ: "10", askP: 201.3, askQ: "12", ...depth,
            }] },
          },
        },
      },
    },
  };
}

test("extracts first-level bid and ask in integer paise from Upstox full feed", () => {
  assert.deepEqual(extractUpstoxExecutableQuote(response(), KEY, { nowMs: NOW }), {
    instrumentKey: KEY, timestampMs: NOW - 1000, ageMs: 1000,
    bidPricePaise: 20125, askPricePaise: 20130,
  });
});

test("evaluates BUY against ask and SELL against bid, never LTP", () => {
  const buy = evaluateUpstoxDerivativeLimit(response(), KEY, {
    side: "BUY", limitPricePaise: 20130, nowMs: NOW,
  });
  const sell = evaluateUpstoxDerivativeLimit(response(), KEY, {
    side: "SELL", limitPricePaise: 20125, nowMs: NOW,
  });
  assert.equal(buy.eligible, true);
  assert.equal(buy.reason, "LIMIT_REACHED");
  assert.equal(sell.eligible, true);
  assert.equal(sell.reason, "LIMIT_REACHED");
  assert.equal(evaluateUpstoxDerivativeLimit(response(), KEY, {
    side: "BUY", limitPricePaise: 20125, nowMs: NOW,
  }).eligible, false);
});

test("does not treat a price without displayed executable quantity as depth", () => {
  const result = extractUpstoxExecutableQuote(response({ askQ: "0" }), KEY, { nowMs: NOW });
  assert.equal(result.askPricePaise, null);
  assert.equal(evaluateUpstoxDerivativeLimit(response({ askQ: "0" }), KEY, {
    side: "BUY", limitPricePaise: 99999, nowMs: NOW,
  }).reason, "MISSING_EXECUTABLE_SIDE");
});

test("supports Upstox firstLevelWithGreeks firstDepth feed", () => {
  const payload = {
    currentTs: String(NOW - 500),
    feeds: {
      [KEY]: {
        firstLevelWithGreeks: {
          firstDepth: { bidP: 201.2, bidQ: "2", askP: 201.4, askQ: "3" },
        },
      },
    },
  };
  const result = extractUpstoxExecutableQuote(payload, KEY, { nowMs: NOW });
  assert.equal(result.bidPricePaise, 20120);
  assert.equal(result.askPricePaise, 20140);
});

test("rejects missing instrument, malformed feed and absent depth without LTP fallback", () => {
  assert.throws(() => extractUpstoxExecutableQuote(response(), "NSE_FO|OTHER", { nowMs: NOW }), { status: 409 });
  assert.throws(() => extractUpstoxExecutableQuote({
    currentTs: String(NOW - 100), feeds: { [KEY]: { ltpc: { ltp: 999 } } },
  }, KEY, { nowMs: NOW }), { status: 409 });
  assert.throws(() => extractUpstoxExecutableQuote(null, KEY, { nowMs: NOW }), { status: 409 });
});

test("rejects stale, future-dated and malformed feed timestamps", () => {
  for (const currentTs of [String(NOW - 15001), String(NOW + 1), "bad", null]) {
    assert.throws(() => extractUpstoxExecutableQuote({
      currentTs, feeds: response().feeds,
    }, KEY, { nowMs: NOW }), { status: 409 });
  }
});

test("rejects malformed, non-positive and sub-paise depth prices", () => {
  for (const depth of [
    { askP: 0 }, { askP: -1 }, { askP: "201.30" }, { askP: 201.301 },
    { bidP: Infinity }, { bidQ: "bad" },
  ]) {
    const quote = extractUpstoxExecutableQuote(response(depth), KEY, { nowMs: NOW });
    assert.equal(quote.askPricePaise === null || quote.bidPricePaise === null, true);
  }
});

test("accepts the exact 15-second snapshot boundary and rejects one millisecond older", () => {
  const boundary = response();
  boundary.currentTs = String(NOW - 15000);
  assert.equal(extractUpstoxExecutableQuote(boundary, KEY, { nowMs: NOW }).ageMs, 15000);
  const stale = response();
  stale.currentTs = String(NOW - 15001);
  assert.throws(() => extractUpstoxExecutableQuote(stale, KEY, { nowMs: NOW }), { status: 409 });
});

test("rejects unsafe feed timestamps and unsafe displayed quantities", () => {
  const unsafeTime = response();
  unsafeTime.currentTs = String(Number.MAX_SAFE_INTEGER + 1);
  assert.throws(() => extractUpstoxExecutableQuote(unsafeTime, KEY, { nowMs: NOW }), { status: 409 });
  const unsafeQuantity = response({ bidQ: String(Number.MAX_SAFE_INTEGER + 1) });
  assert.equal(extractUpstoxExecutableQuote(unsafeQuantity, KEY, { nowMs: NOW }).bidPricePaise, null);
});

test("rejects a crossed executable order book", () => {
  const crossed = response({ bidP: 201.4, askP: 201.3 });
  assert.throws(() => extractUpstoxExecutableQuote(crossed, KEY, { nowMs: NOW }), {
    status: 409,
    message: "Upstox returned a crossed bid/ask book; executable quote rejected.",
  });
});
