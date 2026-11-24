"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fixtures = require("../../markets/stocks/equity-dummy-fixtures.json");
const {createEngine} = require("../../markets/stocks/equity-dummy-engine");

const INFY = fixtures.instruments[0].instrumentKey;
const RELIANCE = fixtures.instruments[1].instrumentKey;
const buy = (overrides = {}) => ({
  instrumentKey: INFY, side: "BUY", product: "DELIVERY",
  orderType: "LIMIT", quantity: 5, limitPricePaise: 152350,
  idempotencyKey: "demo-key-0001", ...overrides
});

test("fixture is explicit demo data with a virtual ten-lakh account", () => {
  const engine = createEngine({fixtures});
  assert.equal(engine.mode, "DEMO_JSON");
  assert.match(engine.label, /NOT LIVE/);
  assert.equal(engine.snapshot().cashPaise, 100000000);
  assert.equal(engine.getInstrumentMaster().length, 3);
});

test("validates side, product, order type, quantity, tick and idempotency", () => {
  const engine = createEngine({fixtures});
  for (const input of [
    buy({side:"SHORT"}), buy({product:"CARRY"}), buy({orderType:"STOP"}),
    buy({quantity:0}), buy({quantity:1.5}), buy({limitPricePaise:152351}),
    buy({idempotencyKey:""})
  ]) assert.throws(() => engine.submitOrder(input));
});

test("Delivery and Intraday positions remain isolated", () => {
  const engine = createEngine({fixtures});
  const delivery = engine.submitOrder(buy({orderType:"MARKET",limitPricePaise:undefined,quantity:5,idempotencyKey:"delivery-001"}));
  const intraday = engine.submitOrder(buy({orderType:"MARKET",limitPricePaise:undefined,product:"INTRADAY",quantity:4,idempotencyKey:"intraday-001"}));
  assert.equal(delivery.status, "CANCELLED");
  assert.equal(intraday.status, "CANCELLED");
  assert.equal(delivery.filledQuantity,3);
  assert.equal(delivery.remainingQuantity,2);
  const positions = engine.snapshot().positions;
  assert.equal(positions.find(p=>p.product==="DELIVERY").quantity,3);
  assert.equal(positions.find(p=>p.product==="INTRADAY").quantity,3);
});

test("MARKET BUY/SELL executes immediately and preserves individual receipts", () => {
  const engine = createEngine({fixtures:{...fixtures,instruments:fixtures.instruments.map(x=>({...x,maxFillQuantity:10}))}});
  const bought = engine.submitOrder(buy({orderType:"MARKET",limitPricePaise:undefined,quantity:2,idempotencyKey:"market-buy-01"}));
  assert.equal(bought.status,"FILLED");
  const sold = engine.submitOrder(buy({side:"SELL",orderType:"MARKET",limitPricePaise:undefined,quantity:1,idempotencyKey:"market-sell-01"}));
  assert.equal(sold.status,"FILLED");
  assert.equal(engine.getTradeReceipts().length,2);
  assert.equal(engine.snapshot().positions[0].quantity,1);
});

test("LIMIT BUY supports multiple partial fills, weighted average and cancel remainder", () => {
  const engine = createEngine({fixtures});
  const order = engine.submitOrder(buy());
  assert.equal(order.status,"PENDING");
  assert.equal(engine.snapshot().reservedCashPaise, 761750);
  const first = engine.processQuote(INFY,152345,{maxFillQuantity:2});
  assert.equal(first.length,1);
  let current = engine.getOrder(order.orderId);
  assert.equal(current.status,"PARTIALLY_FILLED");
  assert.equal(current.filledQuantity,2);
  assert.equal(current.remainingQuantity,3);
  const second = engine.processQuote(INFY,152340,{maxFillQuantity:1});
  assert.equal(second.length,1);
  current = engine.getOrder(order.orderId);
  assert.equal(current.filledQuantity,3);
  assert.equal(current.remainingQuantity,2);
  assert.equal(current.averageExecutionPricePaise, Math.floor((152345*2+152340)/3));
  const cancelled = engine.cancelOrder(order.orderId);
  assert.equal(cancelled.status,"CANCELLED");
  assert.equal(cancelled.filledQuantity,3);
  assert.equal(cancelled.remainingQuantity,2);
  assert.equal(cancelled.remainingReservedCashPaise,0);
  assert.equal(engine.snapshot().reservedCashPaise,0);
  assert.equal(engine.getTradeReceipts(order.orderId).length,2);
  assert.deepEqual(engine.processQuote(INFY,152335), []); // Cancelled remainder must stay terminal and produce no new fill.
});

test("LIMIT SELL reserves shares, partially fills and releases only the remainder on cancel", () => {
  const engine = createEngine({fixtures:{...fixtures,instruments:fixtures.instruments.map(x=>({...x,maxFillQuantity:10}))}});
  engine.submitOrder(buy({orderType:"MARKET",limitPricePaise:undefined,quantity:5,idempotencyKey:"seed-buy-01"}));
  const sell = engine.submitOrder(buy({side:"SELL",quantity:4,limitPricePaise:152350,idempotencyKey:"limit-sell-01"}));
  assert.equal(sell.status,"PENDING");
  assert.equal(engine.snapshot().positions[0].reservedQuantity,4);
  engine.processQuote(INFY,152355,{maxFillQuantity:2});
  const partial = engine.getOrder(sell.orderId);
  assert.equal(partial.status,"PARTIALLY_FILLED");
  assert.equal(partial.filledQuantity,2);
  assert.equal(engine.snapshot().positions[0].reservedQuantity,2);
  const cancelled = engine.cancelOrder(sell.orderId);
  assert.equal(cancelled.status,"CANCELLED");
  assert.equal(engine.snapshot().positions[0].quantity,3);
  assert.equal(engine.snapshot().positions[0].reservedQuantity,0);
});

test("repeated partial SELL closes exact residual cost basis", () => {
  const engine = createEngine({fixtures:{...fixtures,instruments:fixtures.instruments.map(x=>({...x,maxFillQuantity:10}))}});
  engine.submitOrder(buy({orderType:"MARKET",limitPricePaise:undefined,quantity:3,idempotencyKey:"basis-buy-01"}));
  const sell = engine.submitOrder(buy({side:"SELL",quantity:3,limitPricePaise:152350,idempotencyKey:"basis-sell-01"}));
  engine.processQuote(INFY,152355,{maxFillQuantity:1});
  engine.processQuote(INFY,152360,{maxFillQuantity:1});
  engine.processQuote(INFY,152365,{maxFillQuantity:1});
  assert.equal(engine.getOrder(sell.orderId).status,"FILLED");
  assert.equal(engine.snapshot().positions[0].quantity,0);
  assert.equal(engine.snapshot().positions[0].costBasisPaise,0);
  assert.equal(engine.getTradeReceipts(sell.orderId).length,3);
});

test("LIMIT BUY cannot exceed available cash and LIMIT SELL cannot oversell", () => {
  const engine = createEngine({fixtures:{...fixtures,startingCashPaise:1000}});
  const tooLarge = engine.submitOrder(buy({quantity:5,idempotencyKey:"cash-limit-01"}));
  assert.equal(tooLarge.status,"REJECTED");
  assert.equal(engine.snapshot().reservedCashPaise,0);
  const noShares = engine.submitOrder(buy({side:"SELL",idempotencyKey:"sell-limit-01"}));
  assert.equal(noShares.status,"REJECTED");
});

test("idempotent order replay returns original order; changed payload is rejected", () => {
  const engine = createEngine({fixtures});
  const first = engine.submitOrder(buy());
  const replay = engine.submitOrder(buy());
  assert.equal(replay.orderId,first.orderId);
  assert.equal(engine.snapshot().orders.length,1);
  assert.throws(()=>engine.submitOrder(buy({quantity:4})),/different order payload/);
});

test("execution retry returns the original immutable receipt without double accounting", () => {
  const engine = createEngine({fixtures:{...fixtures,instruments:fixtures.instruments.map(x=>({...x,maxFillQuantity:10}))}});
  const order = engine.submitOrder(buy({quantity:2}));
  const first = engine.executeFill(order.orderId,2,152345,"stable-execution-0001");
  const afterFirst = engine.snapshot();
  const replay = engine.executeFill(order.orderId,2,152345,"stable-execution-0001");
  assert.deepEqual(replay,first);
  assert.equal(engine.getTradeReceipts(order.orderId).length,1);
  assert.equal(engine.snapshot().cashPaise,afterFirst.cashPaise);
  assert.throws(()=>engine.executeFill(order.orderId,1,152345,"stable-execution-0001"),/different fill payload/);
});

test("BSE and NSE instruments are distinct and deterministic quote data is fixed", () => {
  const engine = createEngine({fixtures});
  assert.notEqual(INFY,RELIANCE);
  assert.equal(engine.getInstrumentMaster()[0].quotePaise,152345);
  assert.equal(engine.getInstrumentMaster()[2].exchange,"BSE");
});
