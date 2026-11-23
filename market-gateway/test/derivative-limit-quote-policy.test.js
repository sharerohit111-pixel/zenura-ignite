"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateDerivativeLimitQuote } = require("../lib/derivative-limit-quote-policy");

const base = {
  limitPricePaise: 10000,
  bidPricePaise: 9990,
  askPricePaise: 10010,
  quoteTimestampMs: 100000,
  nowMs: 110000,
};

test("BUY LIMIT triggers on executable ask at or below limit, not on LTP/bid", () => {
  assert.deepEqual(evaluateDerivativeLimitQuote({ ...base, side: "BUY", askPricePaise: 10000 }), {
    eligible: true, reason: "LIMIT_REACHED", quoteAgeMs: 10000, executablePricePaise: 10000,
  });
  assert.equal(evaluateDerivativeLimitQuote({ ...base, side: "BUY" }).eligible, false);
});

test("SELL LIMIT triggers on executable bid at or above limit, not on LTP/ask", () => {
  assert.deepEqual(evaluateDerivativeLimitQuote({ ...base, side: "SELL", bidPricePaise: 10000 }), {
    eligible: true, reason: "LIMIT_REACHED", quoteAgeMs: 10000, executablePricePaise: 10000,
  });
  assert.equal(evaluateDerivativeLimitQuote({ ...base, side: "SELL" }).eligible, false);
});

test("quote exactly at max age is accepted and older quote fails closed", () => {
  const accepted = evaluateDerivativeLimitQuote({ ...base, side: "BUY", askPricePaise: 9990, nowMs: 115000 });
  assert.equal(accepted.eligible, true);
  assert.equal(accepted.quoteAgeMs, 15000);
  const stale = evaluateDerivativeLimitQuote({ ...base, side: "BUY", askPricePaise: 9990, nowMs: 115001 });
  assert.equal(stale.eligible, false);
  assert.equal(stale.reason, "STALE_QUOTE");
});

test("future-dated quote fails closed", () => {
  const result = evaluateDerivativeLimitQuote({ ...base, side: "BUY", quoteTimestampMs: 110001, nowMs: 110000 });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "FUTURE_QUOTE");
});

test("missing executable side fails closed without falling back to LTP", () => {
  const result = evaluateDerivativeLimitQuote({
    side: "BUY", limitPricePaise: 10000, bidPricePaise: 9000,
    quoteTimestampMs: 100000, nowMs: 100000,
    ltpPricePaise: 8000,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "MISSING_EXECUTABLE_SIDE");
});

test("invalid side, price, timestamp and age are rejected", () => {
  assert.throws(() => evaluateDerivativeLimitQuote({ ...base, side: "HOLD" }), TypeError);
  assert.throws(() => evaluateDerivativeLimitQuote({ ...base, side: "BUY", limitPricePaise: 0 }), TypeError);
  assert.throws(() => evaluateDerivativeLimitQuote({ ...base, side: "BUY", nowMs: Number.MAX_SAFE_INTEGER + 1 }), TypeError);
  assert.throws(() => evaluateDerivativeLimitQuote({ ...base, side: "BUY", maxQuoteAgeMs: 0 }), TypeError);
});
