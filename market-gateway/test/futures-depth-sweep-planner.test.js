"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { planFuturesDepthSweep } = require("../lib/futures-depth-sweep-planner");

const snapshot = {
  providerId: "UPSTOX",
  instrumentKey: "NSE_FO|NIFTY26NOVFUT",
  bids: [
    { pricePaise: 2500000, quantity: 2 },
    { pricePaise: 2499995, quantity: 4 }
  ],
  asks: [
    { pricePaise: 2500005, quantity: 1 },
    { pricePaise: 2500010, quantity: 3 }
  ]
};

test("BUY sweeps asks in ascending order and preserves individual fill legs", () => {
  const result = planFuturesDepthSweep({ snapshot, side: "BUY", quantity: 3, tickSizePaise: 5 });
  assert.deepEqual(result.fills, [
    { pricePaise: 2500005, quantity: 1, grossPaise: 2500005 },
    { pricePaise: 2500010, quantity: 2, grossPaise: 5000020 }
  ]);
  assert.equal(result.grossPaise, 7500025);
  assert.equal(result.filledQuantity, 3);
  assert.equal(result.executionPolicy, "ASK_DEPTH_ASCENDING");
});

test("SELL sweeps bids in descending order and preserves individual fill legs", () => {
  const result = planFuturesDepthSweep({ snapshot, side: "SELL", quantity: 5, tickSizePaise: 5 });
  assert.deepEqual(result.fills, [
    { pricePaise: 2500000, quantity: 2, grossPaise: 5000000 },
    { pricePaise: 2499995, quantity: 3, grossPaise: 7499985 }
  ]);
  assert.equal(result.grossPaise, 12499985);
  assert.equal(result.executionPolicy, "BID_DEPTH_DESCENDING");
});

test("rejects entire request when total displayed depth is insufficient", () => {
  assert.throws(() => planFuturesDepthSweep({
    snapshot, side: "BUY", quantity: 5, tickSizePaise: 5
  }), /full paper MARKET order was rejected/);
});

test("rejects off-tick, malformed and unordered depth", () => {
  assert.throws(() => planFuturesDepthSweep({
    snapshot: { ...snapshot, asks: [{ pricePaise: 2500006, quantity: 1 }] },
    side: "BUY", quantity: 1, tickSizePaise: 5
  }), /invalid price or quantity/);
  assert.throws(() => planFuturesDepthSweep({
    snapshot: { ...snapshot, bids: [{ pricePaise: 2499995, quantity: 1 }, { pricePaise: 2500000, quantity: 1 }] },
    side: "SELL", quantity: 1, tickSizePaise: 5
  }), /not ordered/);
});

test("does not mutate the source snapshot and returns immutable plan", () => {
  const before = JSON.stringify(snapshot);
  const result = planFuturesDepthSweep({ snapshot, side: "BUY", quantity: 2, tickSizePaise: 5 });
  assert.equal(JSON.stringify(snapshot), before);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.fills));
  assert.ok(result.fills.every(Object.isFrozen));
  assert.equal(result.simulationOnly, true);
});
