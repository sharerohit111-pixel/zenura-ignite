"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRedisMarketFeedTransport } = require("../lib/redis-market-feed-transport");

test("Redis transport publishes bounded JSON only to the S-TRADE market-data namespace", async () => {
  const calls = [];
  const transport = createRedisMarketFeedTransport({
    publisher: { async publish(channel, payload) { calls.push({ channel, payload }); return 1; } },
  });
  assert.equal(await transport.publish("s-trade:market-data:NSE_EQ%7CABC", { price: 123 }), 1);
  assert.deepEqual(calls, [{
    channel: "s-trade:market-data:NSE_EQ%7CABC",
    payload: '{"price":123}',
  }]);
});

test("Redis transport rejects arbitrary channels and oversized events", async () => {
  const transport = createRedisMarketFeedTransport({
    publisher: { async publish() { throw new Error("must not publish"); } },
    maxPayloadBytes: 256,
  });
  await assert.rejects(transport.publish("other-channel", { price: 1 }), { code: "invalid_market_feed_message" });
  await assert.rejects(transport.publish("s-trade:market-data:ABC", { data: "x".repeat(300) }), { code: "market_feed_payload_too_large" });
});

test("closed Redis transport rejects future publishes", async () => {
  const transport = createRedisMarketFeedTransport({ publisher: { async publish() { return 1; } } });
  await transport.close();
  await assert.rejects(transport.publish("s-trade:market-data:ABC", { price: 1 }), { code: "market_feed_transport_closed" });
});
