"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAngelOneStreamLifecycle } = require("../lib/angelone-stream-lifecycle");

test("connects with a bounded subscription snapshot and exposes heartbeat cadence", () => {
  let now = 100000;
  const lifecycle = createAngelOneStreamLifecycle({ now: () => now });
  assert.deepEqual(lifecycle.setSubscriptions(["3045", "26000", "3045"]), ["3045", "26000"]);
  const connection = lifecycle.beginConnection();
  const opened = lifecycle.onOpen(connection.generation);
  assert.equal(opened.heartbeatIntervalMs, 30000);
  assert.deepEqual(opened.subscriptions, ["3045", "26000"]);
  assert.equal(lifecycle.heartbeatDue(), false);
  now += 30000;
  assert.equal(lifecycle.heartbeatDue(), true);
  assert.equal(lifecycle.markHeartbeatSent(connection.generation).sentAtMs, now);
  assert.equal(lifecycle.heartbeatDue(), false);
  now += 10;
  assert.equal(lifecycle.onHeartbeatAck(connection.generation).acknowledgedAtMs, now);
});

test("rejects invalid subscription sets and more than 1000 tokens", () => {
  const lifecycle = createAngelOneStreamLifecycle();
  assert.throws(() => lifecycle.setSubscriptions([""]), { code: "stream_lifecycle_invalid" });
  assert.throws(() => lifecycle.setSubscriptions(Array.from({ length: 1001 }, (_, i) => String(i))), {
    code: "stream_lifecycle_invalid",
  });
});

test("uses bounded exponential reconnect delay and resubmits desired tokens on open", () => {
  let now = 5000;
  const lifecycle = createAngelOneStreamLifecycle({
    now: () => now,
    baseBackoffMs: 1000,
    maxBackoffMs: 2500,
    maxReconnectAttempts: 4,
  });
  lifecycle.setSubscriptions(["3045", "26000"]);
  const first = lifecycle.beginConnection();
  lifecycle.onOpen(first.generation);

  const failure1 = lifecycle.onTransportFailure(first.generation);
  assert.equal(failure1.delayMs, 1000);
  assert.throws(() => lifecycle.beginReconnect(), { code: "stream_lifecycle_invalid" });
  now = failure1.retryAtMs;
  const second = lifecycle.beginReconnect();
  const reopened = lifecycle.onOpen(second.generation);
  assert.deepEqual(reopened.subscriptions, ["3045", "26000"]);

  const failure2 = lifecycle.onTransportFailure(second.generation);
  assert.equal(failure2.delayMs, 1000);
  now = failure2.retryAtMs;
  const third = lifecycle.beginReconnect();
  lifecycle.onOpen(third.generation);
  const failure3 = lifecycle.onTransportFailure(third.generation);
  assert.equal(failure3.delayMs, 1000);
});

test("caps exponential backoff and fails closed after retry budget is exhausted", () => {
  let now = 1000;
  const lifecycle = createAngelOneStreamLifecycle({
    now: () => now,
    baseBackoffMs: 1000,
    maxBackoffMs: 1500,
    maxReconnectAttempts: 2,
  });
  const first = lifecycle.beginConnection();
  lifecycle.onOpen(first.generation);
  const retry1 = lifecycle.onTransportFailure(first.generation);
  assert.equal(retry1.delayMs, 1000);
  now = retry1.retryAtMs;
  const second = lifecycle.beginReconnect();
  lifecycle.onOpen(second.generation);
  const retry2 = lifecycle.onTransportFailure(second.generation);
  assert.equal(retry2.delayMs, 1500);
  now = retry2.retryAtMs;
  const third = lifecycle.beginReconnect();
  lifecycle.onOpen(third.generation);
  const exhausted = lifecycle.onTransportFailure(third.generation);
  assert.equal(exhausted.state, "failed");
  assert.equal(exhausted.retryAtMs, null);
  assert.equal(lifecycle.getState().state, "failed");
});

test("ignores stale callbacks after reconnect and close", () => {
  let now = 2000;
  const lifecycle = createAngelOneStreamLifecycle({ now: () => now });
  const first = lifecycle.beginConnection();
  lifecycle.onOpen(first.generation);
  const retry = lifecycle.onTransportFailure(first.generation);
  now = retry.retryAtMs;
  const second = lifecycle.beginReconnect();
  lifecycle.onOpen(second.generation);
  assert.throws(() => lifecycle.onHeartbeatAck(first.generation), {
    code: "stale_stream_generation",
  });
  lifecycle.close();
  assert.throws(() => lifecycle.onTransportFailure(second.generation), {
    code: "stale_stream_generation",
  });
});

test("does not claim to send heartbeat or reconnect without transport action", () => {
  let now = 1000;
  const lifecycle = createAngelOneStreamLifecycle({ now: () => now });
  const first = lifecycle.beginConnection();
  lifecycle.onOpen(first.generation);
  now += 30000;
  assert.equal(lifecycle.heartbeatDue(), true);
  assert.equal(lifecycle.getState().lastHeartbeatSentAtMs, 1000);
  assert.equal(lifecycle.getState().state, "connected");
});
