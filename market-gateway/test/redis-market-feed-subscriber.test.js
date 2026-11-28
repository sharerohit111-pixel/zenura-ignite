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
    async pSubscribe(pattern, callback) { calls.push(["subscribe", pattern]); listener = callback; },
    async pUnsubscribe(pattern) { calls.push(["unsubscribe", pattern]); },
    ...overrides.subscriber,
  };
  const delivered = [];
  const errors = [];
  const fanout = { async dispatch(event) {
    delivered.push(event);
    return overrides.fanout?.dispatch ? overrides.fanout.dispatch(event) : 1;
  } };
  const bridge = createRedisMarketFeedSubscriber({
    subscriber, fanout, onError: (error) => errors.push(error.code), ...overrides.options,
  });
  return { bridge, calls, delivered, errors, emit: (...args) => listener(...args) };
}

test("subscribes only to the S-TRADE wildcard and dispatches valid events", async () => {
  const h = harness();
  assert.equal(await h.bridge.start(), true);
  assert.deepEqual(h.calls[0], ["subscribe", CHANNEL_PATTERN]);
  const event = { instrumentId: "NSE_EQ|INE001A01036", lastPricePaise: 100 };
  assert.equal(await h.emit(JSON.stringify(event), "s-trade:market-data:NSE_EQ%7CINE001A01036"), 1);
  assert.deepEqual(h.delivered, [event]);
  assert.equal(h.bridge.getStatus().accepted, 1);
});

test("rejects spoofed channels, malformed JSON, identity mismatch and oversized messages", async () => {
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

test("serializes processing and unsubscribes only its own pattern", async () => {
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

test("start failure blocks subscriber and invalid dependencies are rejected", async () => {
  const h = harness({ subscriber: { async pSubscribe() { throw new Error("redis unavailable"); } } });
  await assert.rejects(h.bridge.start(), /redis unavailable/);
  assert.equal(h.bridge.getStatus().state, "blocked");
  assert.throws(() => createRedisMarketFeedSubscriber({ subscriber: {}, fanout: {} }), TypeError);
});

test("stop during pending subscription waits then unsubscribes and never enters running state", async () => {
  let resolveSubscribe;
  const calls = [];
  const subscriber = {
    pSubscribe() { return new Promise((resolve) => { resolveSubscribe = resolve; }); },
    async pUnsubscribe(pattern) { calls.push(pattern); },
  };
  const bridge = createRedisMarketFeedSubscriber({ subscriber, fanout: { async dispatch() { return 1; } } });
  const starting = bridge.start();
  await Promise.resolve();
  const stopping = bridge.stop();
  resolveSubscribe();
  assert.equal(await starting, false);
  assert.equal(await stopping, true);
  assert.equal(bridge.getStatus().state, "stopped");
  assert.deepEqual(calls, [CHANNEL_PATTERN]);
});

test("channel parser validates encoded instrument IDs", () => {
  assert.equal(parseChannel("s-trade:market-data:NSE_EQ%7CABC"), "NSE_EQ|ABC");
  assert.throws(() => parseChannel("s-trade:market-data:%ZZ"), { code: "invalid_market_feed_message" });
  assert.throws(() => parseChannel("s-trade:market-data:*"), { code: "invalid_market_feed_message" });
});


test("subscriber preserves arrival order across a 250-message burst", async () => {
  const order = [];
  const h = harness({ fanout: { async dispatch(event) {
    await Promise.resolve();
    order.push(event.sequence);
    return 1;
  } } });
  await h.bridge.start();

  const pending = Array.from({ length: 250 }, (_, sequence) =>
    h.emit(
      JSON.stringify({ instrumentId: "NSE:BURST", sequence }),
      "s-trade:market-data:NSE:BURST",
    )
  );
  const delivered = await Promise.all(pending);

  assert.equal(delivered.length, 250);
  assert.ok(delivered.every((count) => count === 1));
  assert.deepEqual(order, Array.from({ length: 250 }, (_, sequence) => sequence));
  assert.equal(h.bridge.getStatus().accepted, 250);
  assert.equal(h.bridge.getStatus().rejected, 0);
  assert.equal(h.bridge.getStatus().pendingMessages, 0);
  await h.bridge.stop();
});


test("bounded queue degrades the feed on overflow and stops queued delivery", async () => {
  let releaseDispatch;
  let dispatchStarted;
  const started = new Promise((resolve) => { dispatchStarted = resolve; });
  const gate = new Promise((resolve) => { releaseDispatch = resolve; });
  const overflowErrors = [];
  const h = harness({
    fanout: { async dispatch(event) {
      dispatchStarted();
      await gate;
      return event.sequence;
    } },
    options: {
      maxPendingMessages: 2,
      onOverflow(error) { overflowErrors.push(error.code); },
    },
  });
  await h.bridge.start();

  const first = h.emit(JSON.stringify({ instrumentId: "NSE:QUEUE", sequence: 1 }), "s-trade:market-data:NSE:QUEUE");
  await started;
  const second = h.emit(JSON.stringify({ instrumentId: "NSE:QUEUE", sequence: 2 }), "s-trade:market-data:NSE:QUEUE");
  assert.equal(await h.emit(JSON.stringify({ instrumentId: "NSE:QUEUE", sequence: 3 }), "s-trade:market-data:NSE:QUEUE"), false);

  assert.equal(h.bridge.getStatus().state, "degraded");
  assert.equal(h.bridge.getStatus().pendingMessages, 2);
  assert.equal(h.bridge.getStatus().overflowCount, 1);
  assert.deepEqual(overflowErrors, ["market_feed_queue_overflow"]);

  releaseDispatch();
  assert.equal(await first, 1);
  assert.equal(await second, false);
  assert.deepEqual(h.delivered, [{ instrumentId: "NSE:QUEUE", sequence: 1 }]);
  assert.equal(h.bridge.getStatus().pendingMessages, 0);
  assert.equal(await h.bridge.stop(), true);
  assert.deepEqual(h.calls.at(-1), ["unsubscribe", CHANNEL_PATTERN]);
});

test("rejects invalid pending queue bounds", () => {
  assert.throws(() => harness({ options: { maxPendingMessages: 0 } }), TypeError);
});
