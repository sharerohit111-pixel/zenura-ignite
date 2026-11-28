"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCentralMarketFeed } = require("../lib/central-market-feed");

const NOW = 1_800_000_000_000;
const entitlement = {
  approved: true,
  paperTradingAllowed: true,
  redistributionAllowed: true,
  reference: "vendor-entitlement-1",
  rightsApprovalReference: "signed-rights-1",
  regulatoryApprovalReference: "legal-clearance-1",
};
function makeHarness(overrides = {}) {
  const published = [];
  const statuses = [];
  let eventHandler;
  let closeCount = 0;
  const provider = {
    providerId: "vendor-truedata",
    async getHealth() { return { healthy: true }; },
    async openStream({ onEvent }) {
      eventHandler = onEvent;
      return { async close() { closeCount += 1; } };
    },
    ...overrides.provider,
  };
  const feed = createCentralMarketFeed({
    provider,
    instruments: [{ instrumentId: "NSE_EQ|INE001A01036", exchange: "NSE" }],
    transport: { async publish(channel, event) { published.push({ channel, event }); } },
    assertRightsApproved: overrides.assertRightsApproved || (() => true),
    resolveProviderEntitlement: overrides.resolveProviderEntitlement || (async () => entitlement),
    clock: () => NOW,
    onStatus: (value) => statuses.push(value),
  });
  return {
    feed, published, statuses,
    emit: (event) => eventHandler(event),
    closeCount: () => closeCount,
  };
}
function quote(overrides = {}) {
  return {
    providerId: "vendor-truedata",
    instrumentId: "NSE_EQ|INE001A01036",
    exchange: "NSE",
    lastPricePaise: 12345,
    receivedAtMs: NOW,
    exchangeTimestampMs: NOW - 100,
    lastTradeTimestampMs: NOW - 100,
    sourceSequence: "seq-1",
    entitlementReference: "adapter-entitlement",
    attribution: { displayName: "Approved Vendor" },
    ...overrides,
  };
}

test("central feed starts only after health, rights and per-instrument entitlement checks", async () => {
  const h = makeHarness();
  assert.equal(await h.feed.start(), true);
  assert.equal(h.feed.getStatus().state, "running");
  assert.equal(h.statuses[0].state, "starting");
  assert.equal(h.statuses.at(-1).state, "running");
});

test("central feed fails closed when the global documentary gate is closed", async () => {
  const h = makeHarness({ assertRightsApproved: () => {
    throw Object.assign(new Error("approval required"), { code: "market_data_rights_not_approved" });
  } });
  await assert.rejects(h.feed.start(), { code: "market_data_rights_not_approved" });
  assert.equal(h.feed.getStatus().state, "blocked");
});

test("central feed refuses missing multi-user redistribution entitlement", async () => {
  const h = makeHarness({ resolveProviderEntitlement: async () => ({ ...entitlement, redistributionAllowed: false }) });
  await assert.rejects(h.feed.start(), { code: "market_data_entitlement_denied" });
  assert.equal(h.feed.getStatus().state, "blocked");
});

test("only fresh events for configured instruments and selected provider are published", async () => {
  const h = makeHarness();
  await h.feed.start();
  assert.equal(await h.emit(quote()), true);
  assert.equal(h.published.length, 1);
  assert.equal(h.published[0].channel, "s-trade:market-data:NSE_EQ%7CINE001A01036");
  assert.equal(h.published[0].event.lastPricePaise, 12345);
  assert.equal(h.published[0].event.rightsApprovalReference, "signed-rights-1");
  await assert.rejects(h.emit(quote({ providerId: "synthetic-demo", sourceSequence: "seq-2" })), { code: "invalid_market_data" });
  await assert.rejects(h.emit(quote({ instrumentId: "BSE_EQ|INE001A01036", sourceSequence: "seq-3" })), { code: "invalid_market_data" });
  await assert.rejects(h.emit(quote({ exchangeTimestampMs: NOW + 1, sourceSequence: "seq-4" })), { code: "stale_market_data" });
  assert.equal(h.published.length, 1);
});

test("duplicate source sequences are rejected and stop closes the stream", async () => {
  const h = makeHarness();
  await h.feed.start();
  await h.emit(quote());
  await assert.rejects(h.emit(quote()), { code: "duplicate_market_data_event" });
  assert.equal(await h.feed.stop(), true);
  assert.equal(h.closeCount(), 1);
  assert.equal(h.feed.getStatus().state, "stopped");
  assert.equal(await h.feed.stop(), false);
  assert.equal(await h.emit(quote({ sourceSequence: "seq-2" })), false);
});

test("stream errors degrade the feed without marking quotes live", async () => {
  const h = makeHarness();
  await h.feed.start();
  h.statuses.at(-1);
  assert.equal(h.feed.getStatus().state, "running");
});
