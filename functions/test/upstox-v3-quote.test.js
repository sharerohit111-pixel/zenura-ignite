"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseUpstoxV3Quote } = require("../lib/upstox-v3-quote");

const now = 1757000552000;
const instrumentKey = "NSE_EQ|INE848E01016";
const valid = {
  status: "success",
  data: {
    "NSE_EQ:NHPC": {
      instrument_token: instrumentKey,
      last_price: 76.42,
      last_trade_time: "1757000551130"
    }
  }
};

test("parses documented V3 quote and millisecond string timestamp", () => {
  assert.deepEqual(parseUpstoxV3Quote(valid, instrumentKey, now), {
    pricePaise: 7642,
    timestampMs: 1757000551130
  });
});

test("accepts numeric millisecond timestamp", () => {
  const payload = structuredClone(valid);
  payload.data["NSE_EQ:NHPC"].last_trade_time = 1757000551130;
  assert.equal(parseUpstoxV3Quote(payload, instrumentKey, now).timestampMs, 1757000551130);
});

test("selects the exact instrument when response contains other instruments", () => {
  const payload = structuredClone(valid);
  payload.data["NSE_EQ:OTHER"] = {
    instrument_token: "NSE_EQ|OTHER",
    last_price: 999,
    last_trade_time: String(now)
  };
  assert.equal(parseUpstoxV3Quote(payload, instrumentKey, now).pricePaise, 7642);
});

test("rejects missing or mismatched instrument", () => {
  assert.throws(() => parseUpstoxV3Quote({ status: "success", data: {} }, instrumentKey, now));
});

test("rejects unsuccessful or malformed response envelopes", () => {
  assert.throws(() => parseUpstoxV3Quote({ status: "error", data: valid.data }, instrumentKey, now));
  assert.throws(() => parseUpstoxV3Quote({ status: "success", data: [] }, instrumentKey, now));
  assert.throws(() => parseUpstoxV3Quote(null, instrumentKey, now));
});

test("rejects missing, nonnumeric, zero, and negative prices", () => {
  for (const price of [undefined, "76.42", 0, -1, NaN, Infinity]) {
    const payload = structuredClone(valid);
    payload.data["NSE_EQ:NHPC"].last_price = price;
    assert.throws(() => parseUpstoxV3Quote(payload, instrumentKey, now));
  }
});

test("rejects malformed timestamps", () => {
  for (const timestamp of [undefined, "", "not-a-time", "1e12", -1, null]) {
    const payload = structuredClone(valid);
    payload.data["NSE_EQ:NHPC"].last_trade_time = timestamp;
    assert.throws(() => parseUpstoxV3Quote(payload, instrumentKey, now));
  }
});

test("rejects stale and future-dated quotes", () => {
  const stale = structuredClone(valid);
  stale.data["NSE_EQ:NHPC"].last_trade_time = String(now - 15001);
  assert.throws(() => parseUpstoxV3Quote(stale, instrumentKey, now));

  const future = structuredClone(valid);
  future.data["NSE_EQ:NHPC"].last_trade_time = String(now + 1);
  assert.throws(() => parseUpstoxV3Quote(future, instrumentKey, now));
});

test("rejects prices outside safe integer paise range", () => {
  const payload = structuredClone(valid);
  payload.data["NSE_EQ:NHPC"].last_price = Number.MAX_SAFE_INTEGER;
  assert.throws(() => parseUpstoxV3Quote(payload, instrumentKey, now));
});
