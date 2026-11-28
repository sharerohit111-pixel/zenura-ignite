"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAuthenticatedMarketFeedFanout } = require("../lib/authenticated-market-feed-fanout");

function makeFanout(overrides = {}) {
  return createAuthenticatedMarketFeedFanout({
    authenticate: async (credential) => ({
      userId: credential.userId,
      tenantId: credential.tenantId,
    }),
    authorizeInstrument: async () => ({
      allowed: true,
      entitlementReference: "approved-entitlement",
    }),
    ...overrides,
  });
}

test("fanout delivers only to authenticated connections subscribed to the event instrument", async () => {
  const receivedA = [];
  const receivedB = [];
  const fanout = makeFanout();
  await fanout.subscribe({
    credential: { userId: "user-a", tenantId: "tenant-a" },
    instruments: ["NSE:AAA"],
    send: async (event) => receivedA.push(event),
  });
  await fanout.subscribe({
    credential: { userId: "user-b", tenantId: "tenant-b" },
    instruments: ["NSE:BBB"],
    send: async (event) => receivedB.push(event),
  });

  assert.equal(await fanout.dispatch({ instrumentId: "NSE:AAA", lastPricePaise: 100 }), 1);
  assert.equal(receivedA.length, 1);
  assert.equal(receivedB.length, 0);
});

test("authentication failure and missing instrument entitlement fail closed", async () => {
  const badAuth = makeFanout({ authenticate: async () => null });
  await assert.rejects(badAuth.subscribe({
    credential: "bad",
    instruments: ["NSE:AAA"],
    send: async () => {},
  }), { code: "market_feed_authentication_failed" });

  const deniedFeed = makeFanout({
    authorizeInstrument: async () => ({ allowed: false }),
  });
  await assert.rejects(deniedFeed.subscribe({
    credential: { userId: "u", tenantId: "t" },
    instruments: ["NSE:AAA"],
    send: async () => {},
  }), { code: "market_feed_subscription_denied" });
  assert.equal(deniedFeed.getStatus().connectionCount, 0);
});

test("revocation removes every connection for the exact user and tenant", async () => {
  const received = [];
  const fanout = makeFanout();
  const credential = { userId: "u1", tenantId: "t1" };
  await fanout.subscribe({ credential, instruments: ["NSE:AAA"], send: async (e) => received.push(e) });
  await fanout.subscribe({
    credential: { userId: "u1", tenantId: "t2" },
    instruments: ["NSE:AAA"],
    send: async (e) => received.push(e),
  });

  assert.equal(fanout.revokePrincipal({ userId: "u1", tenantId: "t1" }), 1);
  assert.equal(await fanout.dispatch({ instrumentId: "NSE:AAA" }), 1);
  assert.equal(received.length, 1);
});

test("disconnect and failed send clean up subscriptions", async () => {
  const fanout = makeFanout();
  const subscription = await fanout.subscribe({
    credential: { userId: "u", tenantId: "t" },
    instruments: ["NSE:AAA"],
    send: async () => { throw new Error("socket closed"); },
  });
  assert.equal(await fanout.dispatch({ instrumentId: "NSE:AAA" }), 0);
  assert.equal(fanout.getStatus().connectionCount, 0);
  assert.equal(subscription.unsubscribe(), false);
});

test("bounds, duplicate instrument IDs and closed state are enforced", async () => {
  const fanout = makeFanout({ maxConnections: 1 });
  const args = {
    credential: { userId: "u", tenantId: "t" },
    instruments: ["NSE:AAA"],
    send: async () => {},
  };
  await assert.rejects(fanout.subscribe({ ...args, instruments: ["NSE:AAA", "NSE:AAA"] }), TypeError);
  await fanout.subscribe(args);
  await assert.rejects(fanout.subscribe(args), { code: "market_feed_capacity" });
  assert.equal(fanout.close(), true);
  assert.equal(fanout.getStatus().connectionCount, 0);
  await assert.rejects(fanout.subscribe(args), { code: "market_feed_fanout_closed" });
});
