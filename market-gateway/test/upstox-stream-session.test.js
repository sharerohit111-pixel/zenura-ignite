"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createUpstoxStreamSession } = require("../lib/upstox-stream-session");

const NOW = 1795494600000;
const marketInfo = {
  type: "market_info",
  currentTs: String(NOW - 100),
  marketInfo: { segmentStatus: { NSE_EQ: "NORMAL_OPEN" } },
};
const feed = (id, overrides = {}) => ({
  currentTs: String(NOW - 50),
  feeds: { [id]: { ltpc: { ltp: 100, ltt: String(NOW - 25) } } },
  ...overrides,
});

function session() {
  return createUpstoxStreamSession({
    normalizeQuotes(frame) {
      return Object.entries(frame.feeds).map(([instrumentId, value]) => ({
        instrumentId,
        lastPrice: value.ltpc.ltp,
      }));
    },
  });
}

test("requires market_info before any feed frame", () => {
  const stream = session();
  assert.throws(
    () => stream.processFrame(feed("NSE_EQ|ABC")),
    error => error.code === "stream_protocol_order",
  );
  assert.equal(stream.getState().phase, "awaiting_market_info");
  assert.equal(stream.getState().ready, false);
});

test("accepts market_info but does not declare readiness before a valid snapshot", () => {
  const stream = session();
  const result = stream.processFrame(marketInfo);
  assert.equal(result.kind, "market_info");
  assert.equal(result.ready, false);
  assert.equal(stream.getState().phase, "awaiting_initial_snapshot");
});

test("first non-empty feed is the initial snapshot and subsequent frames are updates", () => {
  const stream = session();
  stream.processFrame(marketInfo);
  const snapshot = stream.processFrame(feed("NSE_EQ|ABC"));
  assert.equal(snapshot.kind, "initial_snapshot");
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.acceptedSnapshotQuotes, 1);

  const update = stream.processFrame(feed("NSE_EQ|ABC", {
    currentTs: String(NOW - 10),
  }));
  assert.equal(update.kind, "live_update");
  assert.equal(update.ready, true);
  assert.equal(stream.getState().phase, "live");
});

test("rejects duplicate market_info after the session has advanced", () => {
  const stream = session();
  stream.processFrame(marketInfo);
  assert.throws(
    () => stream.processFrame(marketInfo),
    error => error.code === "stream_protocol_order",
  );
});

test("rejects malformed market_info and non-array normalizer output", () => {
  const stream = session();
  assert.throws(() => stream.processFrame({
    type: "market_info", currentTs: "0", marketInfo: { segmentStatus: {} },
  }));
  stream.processFrame(marketInfo);
  const bad = createUpstoxStreamSession({ normalizeQuotes: () => null });
  bad.processFrame(marketInfo);
  assert.throws(() => bad.processFrame(feed("NSE_EQ|ABC")));
});

test("empty normalized initial data leaves session unready until a valid quote arrives", () => {
  let allowQuote = false;
  const stream = createUpstoxStreamSession({
    normalizeQuotes(frame) {
      return allowQuote ? [{ instrumentId: Object.keys(frame.feeds)[0] }] : [];
    },
  });
  stream.processFrame(marketInfo);
  const waiting = stream.processFrame(feed("NSE_EQ|ABC"));
  assert.equal(waiting.kind, "awaiting_initial_snapshot");
  assert.equal(waiting.ready, false);
  assert.equal(stream.getState().phase, "awaiting_initial_snapshot");

  allowQuote = true;
  const snapshot = stream.processFrame(feed("NSE_EQ|ABC"));
  assert.equal(snapshot.kind, "initial_snapshot");
  assert.equal(stream.getState().ready, true);
});

test("default session path uses strict entitlement-bound quote normalization", () => {
  const key = "NSE_EQ|INE002A01018";
  const stream = createUpstoxStreamSession({
    instrumentMap: {
      [key]: {
        nativeInstrumentKey: key,
        instrumentId: key,
        exchange: "NSE",
        entitlementReference: "fixture-entitlement",
      },
    },
    now: () => NOW,
  });
  stream.processFrame(marketInfo);
  const valid = stream.processFrame({
    currentTs: String(NOW - 100),
    feeds: { [key]: { ltpc: { ltp: 123.45, ltt: String(NOW - 200) } } },
  }, {
    now: NOW + 60000,
    maxAgeMs: 60000,
    instrumentMap: {},
  });
  assert.equal(valid.kind, "initial_snapshot");
  assert.equal(valid.ready, true);
  assert.equal(valid.quotes[0].lastPricePaise, 12345);
  assert.equal(valid.quotes[0].entitlementReference, "fixture-entitlement");
});

test("default session path remains unready when the initial quote is stale", () => {
  const key = "NSE_EQ|INE002A01018";
  const stream = createUpstoxStreamSession({
    instrumentMap: {
      [key]: {
        nativeInstrumentKey: key,
        instrumentId: key,
        exchange: "NSE",
        entitlementReference: "fixture-entitlement",
      },
    },
    now: () => NOW,
  });
  stream.processFrame(marketInfo);
  const stale = stream.processFrame({
    currentTs: String(NOW - 20000),
    feeds: { [key]: { ltpc: { ltp: 123.45, ltt: String(NOW - 20000) } } },
  });
  assert.equal(stale.kind, "awaiting_initial_snapshot");
  assert.equal(stale.ready, false);
  assert.equal(stream.getState().ready, false);
});
