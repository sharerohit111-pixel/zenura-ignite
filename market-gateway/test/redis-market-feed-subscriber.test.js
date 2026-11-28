"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CHANNEL_PATTERN,
  createRedisMarketFeedSubscriber,
  parseChannel,
} = require("../lib/redis-market-feed-subscriber");

function harness(overrides = {}) {
  const calls = [];
  let listener;
  const subscriber = {
    async pSubscribe(pattern, callback) {
      calls.push(["subscribe", pattern]);
      listener = callback;
    },
    async pUnsubscribe(pattern) { calls.push(["unsubscribe", pattern]); },
    ...overrides.subscriber,
  };
  const delivered = [];
  const errors = [];
  const fanout = {
    async dispatch(event) { delivered.push(event); return 1; },
    ...overrides.fanout,
  };
  const bridge = createRedisMarketFeedSubscriber({
    subscriber,
    fanout,
    onError: (error) => errors.push(error.code),
    ...overrides.options,
  });
  return { bridge, calls, delivered, errors, emit: (...args) => listener(...args) };
}

test("subscribes only to the exact S-TRADE market-data wildcard and dispatches valid events", async () => {
  const h = harness();
  assert.equal(await h.bridge.start(), true);
  assert.deepEqual(h.calls[0], ["subscribe", CHANNEL_PATTERN]);
  const event = { instrumentId: "NSE_EQ|INE001A01036", lastPricePaise: 100 };
  assert.equal(await h.emit(JSON.stringify(event), "s-trade:market-data:NSE_EQ%7CINE001A01036"), 1);
  assert.deepEqual(h.delivered, [event]);
  assert.equal(h.bridge.getStatus().accepted, 1);
});

test("rejects channel spoofing, malformed JSON, identity mismatch and oversized messages", async () => {
  const h = harness({ options: { maxMessageBytes: 256 } });
  await h.bridge.start();
  assert.equal(await h.emit("{", "s-trade:market-data:NSE:AAA"), false);
  assert.equal(await h.emit(JSON.stringify({ instrumentId: "NSE:BBB" }), "s-trade:market-data:NSE:AAA"), false);
  assert.equal(await h.emit(JSON.stringify({ instrumentId: "NSE:AAA", extra: "x".repeat(300) }), "s-trade:market-data:NSE:AAA"), false);
  assert.equal(await h.emit(JSON.stringify({ instrumentId: "NSE:AAA" }), "other:channel"), false);
  assert.equal(h.delivered.length, 0);
  assert.equal(h.bridge.getStatus().rejected, 4);
  assert.equal(h.errors.length, 4);
});

test("message processing is serialized and stop unsubscribes without closing shared Redis client", async () => {
  const order = [];
  const h = harness({ fanout: { async dispatch(event) { order.push(event.seq); return 1; } } });
  await h.bridge.start();
  const one = h.emit(JSON.stringify({ instrumentId: "NSE:AAA", seq: 1 }), "s-trade:market-data:NSE:AAA");
  const two = h.emit(JSON.stringify({ instrumentId: "NSE:AAA", seq: 2 }), "s-trade:market-data:NSE:AAA");
  await Promise.all([one, two]);
  assert.deepEqual(order, [1, 2]);
  assert.equal(await h.bridge.stop(), true);
  assert.deepEqual(h.calls.at(-1), ["unsubscribe", CHANNEL_PATTERN]);
  assert.equal(h.bridge.getStatus().state, "stopped");
  assert.equal(await h.bridge.stop(), false);
});

test("start failure blocks the subscriber and invalid dependencies are rejected", async () => {
  const h = harness({ subscriber: { async pSubscribe() { throw new Error("redis unavailable"); } } });
  await assert.rejects(h.bridge.start(), /redis unavailable/);
  assert.equal(h.bridge.getStatus().state, "blocked");
  assert.throws(() => createRedisMarketFeedSubscriber({ subscriber: {}, fanout: {} }), TypeError);
});

test("channel parser accepts encoded instrument IDs and rejects invalid encodings", () => {
  assert.equal(parseChannel("s-trade:market-data:NSE_EQ%7CABC"), "NSE_EQ|ABC");
  assert.throws(() => parseChannel("s-trade:market-data:%ZZ"), { code: "invalid_market_feed_message" });
  assert.throws(() => parseChannel("s-trade:market-data:*"), { code: "invalid_market_feed_message" });
});
