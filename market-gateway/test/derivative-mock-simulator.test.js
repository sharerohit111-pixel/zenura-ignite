"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createDerivativeMockSimulator } = require("../../markets/stocks/derivative-mock-simulator");

const fixturePath = path.join(__dirname, "../mock/fixtures/derivatives.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const now = Date.parse("2026-11-24T09:30:00+05:30");
const contract = (predicate) => fixture.data.contracts.find(predicate);
const future = () => contract(item => item.assetClass === "FUTURE" && item.symbol === "MOCKNIFTY-FUT-DEC26");
const option = (type, strike) => contract(item => item.assetClass === "OPTION" &&
  item.underlying === "MOCKNIFTY" && item.optionType === type && item.strikePaise === strike &&
  item.expiry === "2026-12-31");
const create = () => createDerivativeMockSimulator(fixture, { now });

test("default simulator clock is anchored to the fixture snapshot, not the wall clock", () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2027-01-01T00:00:00.000Z");
  try {
    const simulator = createDerivativeMockSimulator(fixture);
    const order = simulator.submit({
      instrumentKey: future().instrumentKey, side: "BUY", orderType: "MARKET", lots: 1
    });
    assert.equal(order.status, "FILLED");
    assert.equal(order.createdAt, new Date(Date.parse(fixture.asOf)).toISOString());
  } finally {
    Date.now = originalNow;
  }
});

test("derivatives simulator rejects fixtures without a synthetic timestamp and provenance", () => {
  const noTimestamp = structuredClone(fixture);
  delete noTimestamp.asOf;
  assert.throws(() => createDerivativeMockSimulator(noTimestamp), /valid DEMO DATA derivatives fixture/);
  const noProvenance = structuredClone(fixture);
  delete noProvenance.meta.source;
  assert.throws(() => createDerivativeMockSimulator(noProvenance), /valid DEMO DATA derivatives fixture/);
});

test("fixture exposes multiple synthetic Futures expiries and CE/PE expiry-strike contracts", () => {
  const simulator = create();
  const contracts = simulator.contracts();
  assert.ok(contracts.some(item => item.assetClass === "FUTURE"));
  assert.ok(contracts.some(item => item.assetClass === "OPTION" && item.optionType === "CE"));
  assert.ok(contracts.some(item => item.assetClass === "OPTION" && item.optionType === "PE"));
  assert.ok(new Set(contracts.filter(item => item.assetClass === "OPTION").map(item => item.expiry)).size > 1);
  assert.ok(new Set(contracts.filter(item => item.assetClass === "OPTION").map(item => item.strikePaise)).size > 1);
  assert.ok(contracts.every(item => item.instrumentKey.startsWith("MOCK|") && item.symbol.startsWith("MOCK")));
});

test("Futures MARKET BUY and SELL produce deterministic receipts and signed positions", () => {
  const simulator = create();
  const instrument = future();
  const bought = simulator.submit({ instrumentKey: instrument.instrumentKey, side: "BUY", orderType: "MARKET", lots: 1, product: "INTRADAY" });
  assert.equal(bought.status, "FILLED");
  assert.equal(bought.averageFillPricePaise, 2500050);
  assert.equal(simulator.snapshot().positions[0].netQuantity, 25);
  const sold = simulator.submit({ instrumentKey: instrument.instrumentKey, side: "SELL", orderType: "MARKET", lots: 1, product: "INTRADAY" });
  assert.equal(sold.status, "FILLED");
  assert.equal(sold.averageFillPricePaise, 2500000);
  assert.equal(simulator.snapshot().positions.length, 0);
});

test("Futures SELL can open a short paper position", () => {
  const simulator = create();
  const order = simulator.submit({ instrumentKey: future().instrumentKey, side: "SELL", orderType: "MARKET", lots: 1 });
  assert.equal(order.status, "FILLED");
  assert.equal(simulator.snapshot().positions[0].netQuantity, -25);
});

test("Options CE and PE BUY then SELL-to-close never create short positions", () => {
  const simulator = create();
  for (const type of ["CE", "PE"]) {
    const instrument = option(type, 2500000);
    const buy = simulator.submit({ instrumentKey: instrument.instrumentKey, side: "BUY", orderType: "MARKET", lots: 1 });
    assert.equal(buy.status, "FILLED");
    const sell = simulator.submit({ instrumentKey: instrument.instrumentKey, side: "SELL", orderType: "MARKET", lots: 1 });
    assert.equal(sell.status, "FILLED");
    assert.equal(simulator.snapshot().positions.some(item => item.instrumentKey === instrument.instrumentKey), false);
  }
});

test("Options SELL cannot open or exceed a long CE/PE position", () => {
  const simulator = create();
  const instrument = option("CE", 2500000);
  assert.throws(() => simulator.submit({ instrumentKey: instrument.instrumentKey, side: "SELL", orderType: "MARKET", lots: 1 }), /close unreserved long/);
  simulator.submit({ instrumentKey: instrument.instrumentKey, side: "BUY", orderType: "MARKET", lots: 1 });
  assert.throws(() => simulator.submit({ instrumentKey: instrument.instrumentKey, side: "SELL", orderType: "MARKET", lots: 2 }), /close unreserved long/);
});

test("MARKET insufficient depth is rejected in full without changing positions", () => {
  const simulator = create();
  const instrument = future();
  const order = simulator.submit({ instrumentKey: instrument.instrumentKey, side: "BUY", orderType: "MARKET", lots: 3 });
  assert.equal(order.status, "REJECTED");
  assert.equal(order.filledQuantity, 0);
  assert.equal(simulator.snapshot().positions.length, 0);
});

test("LIMIT orders remain pending, partially fill by whole lots, then fill after quote depth refresh", () => {
  const simulator = create();
  const instrument = future();
  const order = simulator.submit({
    instrumentKey: instrument.instrumentKey, side: "BUY", orderType: "LIMIT",
    lots: 3, limitPricePaise: 2500100, product: "DELIVERY"
  });
  assert.equal(order.status, "PENDING");
  let result = simulator.processLimitFills();
  assert.equal(result.partial, 1);
  let current = simulator.snapshot().orders[0];
  assert.equal(current.filledQuantity, 2 * instrument.lotSize);
  assert.equal(current.remainingQuantity, instrument.lotSize);
  simulator.refreshQuoteDepth();
  result = simulator.processLimitFills();
  assert.equal(result.filled, 1);
  current = simulator.snapshot().orders[0];
  assert.equal(current.status, "FILLED");
  assert.equal(current.filledQuantity, 3 * instrument.lotSize);
});

test("LIMIT cancellation is terminal and releases Options close reservation", () => {
  const simulator = create();
  const instrument = option("PE", 2500000);
  simulator.submit({ instrumentKey: instrument.instrumentKey, side: "BUY", orderType: "MARKET", lots: 2 });
  const sell = simulator.submit({
    instrumentKey: instrument.instrumentKey, side: "SELL", orderType: "LIMIT",
    lots: 1, limitPricePaise: 12900
  });
  let position = simulator.snapshot().positions.find(item => item.instrumentKey === instrument.instrumentKey);
  assert.equal(position.reservedCloseQuantity, 25);
  assert.equal(position.availableCloseQuantity, 25);
  const cancelled = simulator.cancel(sell.orderId);
  assert.equal(cancelled.status, "CANCELLED");
  position = simulator.snapshot().positions.find(item => item.instrumentKey === instrument.instrumentKey);
  assert.equal(position.reservedCloseQuantity, 0);
  assert.equal(position.availableCloseQuantity, 50);
  assert.throws(() => simulator.cancel(sell.orderId), /Only pending/);
});

test("LIMIT BUY and SELL use the correct executable side and reject off-tick prices", () => {
  const simulator = create();
  const instrument = future();
  assert.throws(() => simulator.submit({
    instrumentKey: instrument.instrumentKey, side: "BUY", orderType: "LIMIT", lots: 1, limitPricePaise: 2500101
  }), /tick size/);
  const buy = simulator.submit({
    instrumentKey: instrument.instrumentKey, side: "BUY", orderType: "LIMIT", lots: 1, limitPricePaise: 2500050
  });
  assert.equal(buy.status, "PENDING");
  assert.equal(simulator.processLimitFills().filled, 1);
  const sell = simulator.submit({
    instrumentKey: instrument.instrumentKey, side: "SELL", orderType: "LIMIT", lots: 1, limitPricePaise: 2499950
  });
  assert.equal(sell.status, "PENDING");
  assert.equal(simulator.processLimitFills().filled, 1);
});

test("expired contracts, real instruments and production-mode fixtures fail closed", () => {
  const expiredAt = Date.parse("2026-12-31T15:30:00+05:30");
  assert.throws(() => createDerivativeMockSimulator(fixture, { now: expiredAt, maxQuoteAgeMs: Number.MAX_SAFE_INTEGER }).submit({
    instrumentKey: future().instrumentKey, side: "BUY", orderType: "MARKET", lots: 1
  }), /Expired/);
  const real = JSON.parse(JSON.stringify(fixture));
  real.data.contracts[0].instrumentKey = "NSE_FO|REAL";
  assert.throws(() => createDerivativeMockSimulator(real, { now }), /non-synthetic/);
  const paper = { ...fixture, mode: "PAPER" };
  assert.throws(() => createDerivativeMockSimulator(paper, { now }), /DEMO DATA/);
});

test("snapshot explicitly disclaims cash, charges and margin ledger effects", () => {
  const snapshot = create().snapshot();
  assert.equal(snapshot.mode, "MOCK");
  assert.match(snapshot.accountingNotice, /no cash ledger, charges, margin reservation/);
});


test("Options CE and PE LIMIT BUYs partially and fully fill only in whole lots", () => {
  for (const type of ["CE", "PE"]) {
    const simulator = create();
    const instrument = option(type, 2500000);
    const order = simulator.submit({
      instrumentKey: instrument.instrumentKey, side: "BUY", orderType: "LIMIT",
      lots: 3, limitPricePaise: 20000
    });
    assert.equal(order.status, "PENDING");
    let result = simulator.processLimitFills();
    assert.equal(result.partial, 1);
    let current = simulator.snapshot().orders[0];
    assert.equal(current.filledQuantity, 50);
    assert.equal(current.remainingQuantity, 25);
    simulator.refreshQuoteDepth();
    result = simulator.processLimitFills();
    assert.equal(result.filled, 1);
    current = simulator.snapshot().orders[0];
    assert.equal(current.status, "FILLED");
    assert.equal(current.filledQuantity, 75);
  }
});

test("partially filled Options SELL LIMIT retains only its remaining close reservation until cancel", () => {
  const fixtureWithThinBid = JSON.parse(JSON.stringify(fixture));
  const instrument = option("CE", 2500000);
  const quote = fixtureWithThinBid.data.quotes.find(item => item.instrumentKey === instrument.instrumentKey);
  quote.bidQuantity = 25;
  const simulator = createDerivativeMockSimulator(fixtureWithThinBid, { now });
  simulator.submit({ instrumentKey: instrument.instrumentKey, side: "BUY", orderType: "MARKET", lots: 2 });
  const sell = simulator.submit({
    instrumentKey: instrument.instrumentKey, side: "SELL", orderType: "LIMIT",
    lots: 2, limitPricePaise: 9000
  });
  const result = simulator.processLimitFills();
  assert.equal(result.partial, 1);
  let position = simulator.snapshot().positions.find(item => item.instrumentKey === instrument.instrumentKey);
  assert.equal(position.netQuantity, 25);
  assert.equal(position.reservedCloseQuantity, 25);
  assert.equal(position.availableCloseQuantity, 0);
  const cancelled = simulator.cancel(sell.orderId);
  assert.equal(cancelled.status, "CANCELLED");
  position = simulator.snapshot().positions.find(item => item.instrumentKey === instrument.instrumentKey);
  assert.equal(position.reservedCloseQuantity, 0);
  assert.equal(position.availableCloseQuantity, 25);
});

test("simulator rejects a non-synthetic Options underlying", () => {
  const invalid = structuredClone(fixture);
  const target = invalid.data.contracts.find(item => item.assetClass === "OPTION");
  target.underlying = "NIFTY";
  assert.throws(() => createDerivativeMockSimulator(invalid, { now }), /invalid CE\/PE strike contract/);
});


test("F&O lot boundaries reject zero, fractional and over-cap lots without creating orders",()=>{
  const simulator=create();
  const instrument=future();
  for(const lots of [0,1.5,10001]){
    assert.throws(()=>simulator.submit({
      instrumentKey:instrument.instrumentKey,side:"BUY",orderType:"LIMIT",lots,limitPricePaise:2500050
    }),/Lots (is invalid|exceed the demo limit)/);
  }
  assert.equal(simulator.snapshot().orders.length,0);
  assert.equal(simulator.snapshot().positions.length,0);
});

test("F&O derivative position arithmetic rejects unsafe fill value without returning a position",()=>{
  const simulator=create();
  const instrument=future();
  const altered=structuredClone(fixture);
  const quote=altered.data.quotes.find(item=>item.instrumentKey===instrument.instrumentKey);
  quote.askPricePaise=Math.floor(Number.MAX_SAFE_INTEGER/instrument.tickSizePaise)*instrument.tickSizePaise;
  quote.askQuantity=instrument.lotSize;
  const bounded=createDerivativeMockSimulator(altered,{now});
  const rejected=bounded.submit({
    instrumentKey:instrument.instrumentKey,side:"BUY",orderType:"MARKET",lots:1
  });
  assert.equal(rejected.status,"REJECTED");
  assert.match(rejected.rejectionReason,/safe calculation limits|safe integer limits/);
  assert.equal(bounded.snapshot().positions.length,0);
  assert.equal(bounded.snapshot().orders.length,1);
});


test("rejects stale and future-dated synthetic quotes at construction", () => {
  assert.throws(() => createDerivativeMockSimulator(fixture, { now: now + 15001 }), /stale|invalid deterministic derivative quote/i);
  const futureDated = structuredClone(fixture);
  futureDated.data.quotes[0].timestamp = new Date(now + 1).toISOString();
  assert.throws(() => createDerivativeMockSimulator(futureDated, { now }), /invalid deterministic derivative quote/i);
});

test("rechecks quote freshness at execution time and never fills a stale LIMIT order", () => {
  let clock = now;
  const simulator = createDerivativeMockSimulator(fixture, { now: () => clock });
  const instrument = future();
  const order = simulator.submit({
    instrumentKey: instrument.instrumentKey, side: "BUY", orderType: "LIMIT",
    lots: 1, limitPricePaise: 2500100
  });
  clock = now + 15001;
  assert.throws(() => simulator.processLimitFills(), /stale or future-dated derivative quote/i);
  const current = simulator.snapshot();
  assert.equal(current.orders[0].status, "PENDING");
  assert.equal(current.orders[0].filledQuantity, 0);
  assert.equal(current.positions.length, 0);
  assert.equal(order.status, "PENDING");
  assert.equal(current.mode, "MOCK");
});

test("expires pending derivative LIMIT orders and marks open positions non-valuatable after contract expiry", () => {
  let clock = now;
  const simulator = createDerivativeMockSimulator(fixture, { now: () => clock });
  const instrument = future();
  simulator.submit({ instrumentKey: instrument.instrumentKey, side: "BUY", orderType: "MARKET", lots: 1 });
  const pending = simulator.submit({
    instrumentKey: instrument.instrumentKey, side: "BUY", orderType: "LIMIT",
    lots: 1, limitPricePaise: 2500100
  });
  clock = Date.parse("2026-12-31T10:00:00.000Z");
  const result = simulator.processLimitFills();
  assert.equal(result.expired, 1);
  assert.equal(simulator.snapshot().orders.find(item => item.orderId === pending.orderId).status, "EXPIRED");
  assert.equal(simulator.snapshot().positions[0].valuationStatus, "EXPIRED");
});

test("rejects contract keys whose exchange, underlying, expiry, strike or CE/PE identity disagrees", () => {
  for (const mutate of [
    item => { item.instrumentKey = item.instrumentKey.replace("|NSE|", "|BSE|"); },
    item => { item.instrumentKey = item.instrumentKey.replace("|MOCKNIFTY|", "|MOCKBANK|"); },
    item => { item.instrumentKey = item.instrumentKey.replace("|2026-12-31", "|2027-01-28"); },
    item => { item.instrumentKey = item.instrumentKey.replace("|25000|CE|", "|25100|CE|"); },
    item => { item.instrumentKey = item.instrumentKey.replace("|CE|", "|PE|"); }
  ]) {
    const invalid = structuredClone(fixture);
    const target = invalid.data.contracts.find(item => item.assetClass === "OPTION" && item.expiry === "2026-12-31");
    mutate(target);
    assert.throws(() => createDerivativeMockSimulator(invalid, { now }), /identity does not match/i);
  }
});
