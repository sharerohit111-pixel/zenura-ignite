"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createRedisSubscriberLifecycle } = require("../lib/redis-subscriber-lifecycle");

function harness(overrides = {}) {
  const client = new EventEmitter();
  client.isReady = false;
  const calls = [];
  const lifecycle = createRedisSubscriberLifecycle({
    client,
    ensureSubscription: async ({ generation, isCurrent }) => {
      calls.push(["subscribe", generation]);
      assert.equal(isCurrent(), true);
    },
    markUnavailable: (reason, generation) => calls.push(["unavailable", reason, generation]),
    markReady: (generation) => calls.push(["ready", generation]),
    onError: (error) => calls.push(["error", error.message]),
    ...overrides,
  });
  return { client, lifecycle, calls };
}

test("initial ready creates exactly one subscription for its generation", async () => {
  const h = harness();
  await h.lifecycle.start();
  h.client.emit("ready");
  await h.lifecycle.onReady();
  assert.deepEqual(h.calls.filter((x) => x[0] === "subscribe"), [["subscribe", 0]]);
  assert.equal(h.lifecycle.getStatus().state, "ready");
});

test("duplicate ready events do not duplicate subscription", async () => {
  const h = harness();
  await h.lifecycle.start();
  h.client.emit("ready");
  h.client.emit("ready");
  await h.lifecycle.onReady();
  assert.equal(h.calls.filter((x) => x[0] === "subscribe").length, 1);
});

test("disconnect invalidates old generation and blocks dispatch until ready", async () => {
  const h = harness();
  await h.lifecycle.start();
  h.client.emit("ready");
  await h.lifecycle.onReady();
  const old = h.lifecycle.getStatus().generation;
  h.client.emit("end");
  assert.equal(h.lifecycle.isCurrentGeneration(old), false);
  let dispatched = false;
  assert.equal(await h.lifecycle.dispatchIfCurrent(old, async () => { dispatched = true; }), false);
  assert.equal(dispatched, false);
  assert.equal(h.lifecycle.getStatus().state, "unavailable");
});

test("reconnect ready creates one new generation subscription", async () => {
  const h = harness();
  await h.lifecycle.start();
  h.client.emit("ready");
  await h.lifecycle.onReady();
  h.client.emit("reconnecting");
  h.client.emit("end");
  h.client.emit("ready");
  await h.lifecycle.onReady();
  assert.deepEqual(h.calls.filter((x) => x[0] === "subscribe"), [
    ["subscribe", 0], ["subscribe", 1],
  ]);
  assert.equal(h.lifecycle.getStatus().state, "ready");
});

test("late subscription completion from an old generation cannot restore ready state", async () => {
  let finish;
  const h = harness({
    ensureSubscription: () => new Promise((resolve) => { finish = resolve; }),
  });
  await h.lifecycle.start();
  const pending = h.lifecycle.onReady();
  await Promise.resolve();
  h.client.emit("end");
  finish();
  await pending;
  assert.equal(h.lifecycle.getStatus().state, "unavailable");
  assert.equal(h.lifecycle.getStatus().subscribedGeneration, -1);
});

test("subscription error stays degraded and reports failure", async () => {
  const h = harness({ ensureSubscription: async () => { throw new Error("subscribe failed"); } });
  await h.lifecycle.start();
  h.client.emit("ready");
  await h.lifecycle.onReady();
  assert.equal(h.lifecycle.getStatus().state, "degraded");
  assert.ok(h.calls.some((x) => x[0] === "error" && x[1] === "subscribe failed"));
});

test("stop removes only lifecycle listeners and closes only when ownership is explicit", async () => {
  const h = harness();
  let quit = 0;
  h.client.quit = async () => { quit += 1; };
  const unrelated = () => {};
  h.client.on("ready", unrelated);
  await h.lifecycle.start();
  assert.equal(await h.lifecycle.stop(), true);
  assert.equal(await h.lifecycle.stop(), false);
  assert.equal(quit, 0);
  assert.equal(h.client.listeners("ready").includes(unrelated), true);
});

test("owned client is closed once on shutdown", async () => {
  const h = harness({ closeOwnedClient: true });
  let quit = 0;
  h.client.quit = async () => { quit += 1; };
  await h.lifecycle.start();
  await h.lifecycle.stop();
  assert.equal(quit, 1);
});
