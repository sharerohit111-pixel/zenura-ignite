"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fixture=require("../mock/fixtures/equity-execution.json");
const accountFixture=require("../mock/fixtures/account.json");
const {createEquityDemoExecutionEngine,validateEquityDemoFixture}=require("../lib/equity-demo-execution-engine");
const account=()=>({...accountFixture.data});
const engine=(overrides={})=>createEquityDemoExecutionEngine({fixture,account:{...account(),...(overrides.account||{})},env:{NODE_ENV:"test"}});
const buy=(overrides={})=>({idempotencyKey:"demo-buy-0001",instrumentKey:fixture.data.instrument.instrumentKey,side:"BUY",orderType:"MARKET",product:"DELIVERY",quantity:7,...overrides});

test("execution fixture is synthetic-only, fixed and fee model is explicitly absent",()=>{
  assert.equal(validateEquityDemoFixture(fixture).meta.exchange,"NONE");
  assert.equal(fixture.mode,"MOCK");assert.equal(fixture.simulated,true);
  assert.equal(fixture.meta.source,"SYNTHETIC_FIXTURE");assert.equal(fixture.meta.fees,"NOT_MODELED");
});
test("production mode fails closed and invalid/crossed fixtures are rejected",()=>{
  assert.throws(()=>createEquityDemoExecutionEngine({fixture,account:account(),env:{NODE_ENV:"production"}}),/EQUITY_DEMO_EXECUTION_DISABLED_IN_PRODUCTION/);
  assert.throws(()=>validateEquityDemoFixture({...fixture,meta:{...fixture.meta,exchange:"NSE"}}),/INVALID_EQUITY_DEMO_FIXTURE/);
  const crossed=structuredClone(fixture);crossed.data.orderBook.bids[0].pricePaise=125050;
  assert.throws(()=>validateEquityDemoFixture(crossed),/CROSSED_EQUITY_DEMO_ORDER_BOOK/);
});
test("market BUY sweeps deterministic ask levels and returns one immutable receipt per partial fill",()=>{
  const e=engine(),order=e.submitOrder(buy());
  assert.equal(order.status,"PENDING");assert.equal(order.reservedCashPaise,125150*7);
  const a=e.matchNext(order.orderId),b=e.matchNext(order.orderId),c=e.matchNext(order.orderId);
  assert.deepEqual([a.fill.quantity,b.fill.quantity,c.fill.quantity],[2,3,2]);
  assert.deepEqual([a.fill.pricePaise,b.fill.pricePaise,c.fill.pricePaise],[125050,125100,125150]);
  assert.equal(c.order.status,"FILLED");assert.equal(c.order.filledQuantity,7);assert.equal(c.order.remainingQuantity,0);
  assert.equal(c.order.grossValuePaise,875750);assert.equal(c.order.averagePricePaise,125107);
  assert.equal(e.getFillReceipts(order.orderId).length,3);
  assert.deepEqual(e.getFillReceipts(order.orderId).map(x=>x.fillId),["DEMO-EQ-demo-buy-0001-F0001","DEMO-EQ-demo-buy-0001-F0002","DEMO-EQ-demo-buy-0001-F0003"]);
  const snap=e.snapshot();assert.equal(snap.account.cashBalancePaise,100000000-875750);
  assert.equal(snap.account.blockedFundsPaise,0);assert.equal(snap.account.availableFundsPaise,snap.account.cashBalancePaise);
  assert.equal(snap.account.positions[fixture.data.instrument.instrumentKey].quantity,7);
  assert.equal(snap.account.positions[fixture.data.instrument.instrumentKey].costBasisPaise,875750);
});
test("limit BUY fills only marketable levels and cancel releases only the unfilled reservation",()=>{
  const e=engine(),order=e.submitOrder(buy({idempotencyKey:"demo-limit-001",orderType:"LIMIT",quantity:7,limitPricePaise:125100}));
  const first=e.matchNext(order.orderId),second=e.matchNext(order.orderId),third=e.matchNext(order.orderId);
  assert.equal(first.fill.quantity,2);assert.equal(second.fill.quantity,3);
  assert.equal(third.matched,false);assert.equal(third.reason,"LIMIT_NOT_MARKETABLE");
  assert.equal(third.order.status,"PARTIALLY_FILLED");assert.equal(third.order.filledQuantity,5);assert.equal(third.order.remainingQuantity,2);
  const before=e.snapshot(),cancel=e.cancelOrder(order.orderId),after=e.snapshot();
  assert.equal(cancel.order.status,"CANCELLED");assert.equal(cancel.order.filledQuantity,5);assert.equal(cancel.order.remainingQuantity,2);
  assert.equal(cancel.releasedCashPaise,125100*2);
  assert.equal(after.account.cashBalancePaise,before.account.cashBalancePaise);
  assert.equal(after.account.blockedFundsPaise,0);assert.equal(after.account.positions[fixture.data.instrument.instrumentKey].quantity,5);
  assert.equal(e.getFillReceipts(order.orderId).length,2);
  assert.equal(e.cancelOrder(order.orderId).releasedCashPaise,0);
});
test("market SELL reserves shares and realizes cumulative P&L over multiple bid fills",()=>{
  const key=fixture.data.instrument.instrumentKey;
  const e=engine({account:{positions:{[key]:{quantity:7,costBasisPaise:7*124000,averagePricePaise:124000,investedValuePaise:7*124000,reservedQuantity:0}}}});
  const order=e.submitOrder({idempotencyKey:"demo-sell-001",instrumentKey:key,side:"SELL",orderType:"MARKET",product:"DELIVERY",quantity:5});
  assert.equal(e.snapshot().account.positions[key].reservedQuantity,5);
  const a=e.matchNext(order.orderId),b=e.matchNext(order.orderId),c=e.matchNext(order.orderId);
  assert.deepEqual([a.fill.quantity,b.fill.quantity],[2,3]);
  assert.equal(c.order.status,"FILLED");assert.equal(c.order.realizedPnlPaise,4700);
  assert.equal(e.snapshot().account.positions[key].quantity,2);
  assert.equal(e.snapshot().account.positions[key].reservedQuantity,0);
  assert.equal(e.snapshot().account.cashBalancePaise,100000000+624700);
  assert.equal(e.snapshot().account.realizedPnlPaise,4700);
});
test("cancelling a partially filled SELL preserves fills and releases only remaining shares",()=>{
  const key=fixture.data.instrument.instrumentKey;
  const e=engine({account:{positions:{[key]:{quantity:8,costBasisPaise:8*120000,averagePricePaise:120000,reservedQuantity:0}}}});
  const order=e.submitOrder({idempotencyKey:"demo-sell-cancel-1",instrumentKey:key,side:"SELL",orderType:"LIMIT",limitPricePaise:124900,product:"INTRADAY",quantity:7});
  const fill=e.matchNext(order.orderId);assert.equal(fill.fill.quantity,2);
  const cancelled=e.cancelOrder(order.orderId);
  assert.equal(cancelled.order.filledQuantity,2);assert.equal(cancelled.order.remainingQuantity,5);
  assert.equal(cancelled.releasedShareQuantity,5);
  const p=e.snapshot().account.intradayPositions[key];
  assert.equal(p.quantity,8); // product-specific position is isolated; no Delivery shares were consumed.
  assert.equal(e.snapshot().account.positions[key].quantity,8);
});
test("idempotency returns same order for same payload and rejects changed payload",()=>{
  const e=engine(),a=e.submitOrder(buy({quantity:2})),b=e.submitOrder(buy({quantity:2}));
  assert.equal(a.orderId,b.orderId);assert.equal(e.snapshot().orders.length,1);
  assert.throws(()=>e.submitOrder(buy({quantity:3})),/DEMO_IDEMPOTENCY_KEY_REUSED/);
});
test("insufficient cash and unavailable shares fail before state mutation",()=>{
  const e=engine({account:{cashBalancePaise:1000}});
  assert.throws(()=>e.submitOrder(buy({quantity:2})),/INSUFFICIENT_DEMO_CASH/);
  assert.equal(e.snapshot().orders.length,0);
  assert.throws(()=>e.submitOrder({idempotencyKey:"demo-sell-none",instrumentKey:fixture.data.instrument.instrumentKey,side:"SELL",orderType:"MARKET",product:"DELIVERY",quantity:1}),/INSUFFICIENT_DEMO_UNRESERVED_SHARES/);
  assert.equal(e.snapshot().account.blockedFundsPaise,0);
});
test("BUY reservations reconcile through partial fills, full fills and cancellation",()=>{
  const e=engine(),order=e.submitOrder(buy({quantity:9}));
  assert.equal(e.snapshot().account.availableFundsPaise,100000000-125150*9);
  e.matchNext(order.orderId);e.matchNext(order.orderId);e.matchNext(order.orderId);
  const s=e.snapshot();assert.equal(s.orders[0].status,"FILLED");assert.equal(s.account.blockedFundsPaise,0);
  assert.equal(s.account.availableFundsPaise,s.account.cashBalancePaise);
});
test("fill receipt snapshots are detached and timestamps/IDs are deterministic",()=>{
  const a=engine(),b=engine(),oa=a.submitOrder(buy({quantity:2})),ob=b.submitOrder(buy({quantity:2}));
  const fa=a.matchNext(oa.orderId).fill,fb=b.matchNext(ob.orderId).fill;
  assert.deepEqual(fa,fb);fa.quantity=999;
  assert.equal(a.getFillReceipts(oa.orderId)[0].quantity,2);
  assert.equal(fa.filledAt,"2026-11-24T04:00:01.000Z");
});
test("Delivery and Intraday positions are accounted in separate books",()=>{
  const e=engine(),delivery=e.submitOrder(buy({quantity:1}));
  e.matchNext(delivery.orderId);
  const intraday=e.submitOrder(buy({idempotencyKey:"demo-intra-001",product:"INTRADAY",quantity:1}));
  e.matchNext(intraday.orderId);
  const s=e.snapshot();assert.equal(s.account.positions[fixture.data.instrument.instrumentKey].quantity,1);
  assert.equal(s.account.intradayPositions[fixture.data.instrument.instrumentKey].quantity,1);
});
