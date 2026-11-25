"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
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
  assert.equal(fixture.data.instrument.markPricePaise,125050);
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
  assert.equal(c.order.grossValuePaise,875700);assert.equal(c.order.averagePricePaise,125100);
  assert.equal(e.getFillReceipts(order.orderId).length,3);
  assert.deepEqual(e.getFillReceipts(order.orderId).map(x=>x.fillId),["DEMO-EQ-demo-buy-0001-F0001","DEMO-EQ-demo-buy-0001-F0002","DEMO-EQ-demo-buy-0001-F0003"]);
  const snap=e.snapshot();assert.equal(snap.account.cashBalancePaise,100000000-875700);
  assert.equal(snap.account.blockedFundsPaise,0);assert.equal(snap.account.availableFundsPaise,snap.account.cashBalancePaise);
  assert.equal(snap.account.positions[fixture.data.instrument.instrumentKey].quantity,7);
  assert.equal(snap.account.positions[fixture.data.instrument.instrumentKey].costBasisPaise,875700);
  assert.deepEqual(snap.valuation,{instrumentKey:fixture.data.instrument.instrumentKey,markPricePaise:125050,quantity:7,costBasisPaise:875700,marketValuePaise:875350,unrealizedPnlPaise:-350,totalPnlPaise:-350});
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
  assert.equal(c.order.status,"FILLED");assert.equal(c.order.realizedPnlPaise,4600);
  assert.equal(e.snapshot().account.positions[key].quantity,2);
  assert.equal(e.snapshot().account.positions[key].reservedQuantity,0);
  assert.equal(e.snapshot().account.cashBalancePaise,100000000+624600);
  assert.equal(e.snapshot().account.realizedPnlPaise,4600);
});
test("cancelling a partially filled SELL preserves fills and releases only remaining shares",()=>{
  const key=fixture.data.instrument.instrumentKey;
  const e=engine({account:{positions:{[key]:{quantity:8,costBasisPaise:8*120000,averagePricePaise:120000,reservedQuantity:0}},intradayPositions:{[key]:{quantity:8,costBasisPaise:8*120000,averagePricePaise:120000,reservedQuantity:0}}}});
  const order=e.submitOrder({idempotencyKey:"demo-sell-cancel-1",instrumentKey:key,side:"SELL",orderType:"LIMIT",limitPricePaise:124900,product:"INTRADAY",quantity:7});
  const fill=e.matchNext(order.orderId);assert.equal(fill.fill.quantity,2);
  const cancelled=e.cancelOrder(order.orderId);
  assert.equal(cancelled.order.filledQuantity,2);assert.equal(cancelled.order.remainingQuantity,5);
  assert.equal(cancelled.releasedShareQuantity,5);
  const p=e.snapshot().account.intradayPositions[key];
  assert.equal(p.quantity,6); // two executed shares remain sold after cancellation.
  assert.equal(p.reservedQuantity,0);
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

test("execution ID replay returns the original receipt without double accounting",()=>{
  const e=engine(),order=e.submitOrder(buy({quantity:3}));
  const first=e.matchNext(order.orderId,{executionId:"stable-fill-replay-01"});
  const afterFirst=e.snapshot();
  const replay=e.matchNext(order.orderId,{executionId:"stable-fill-replay-01"});
  assert.deepEqual(replay,first);
  assert.deepEqual(e.snapshot(),afterFirst);
  assert.equal(e.getFillReceipts(order.orderId).length,1);
  const other=e.submitOrder(buy({idempotencyKey:"demo-buy-other-01",quantity:1}));
  assert.throws(()=>e.matchNext(other.orderId,{executionId:"stable-fill-replay-01"}),/DEMO_EXECUTION_ID_REUSED/);
});

test("repeated partial SELL allocates exact residual cost basis on final close",()=>{
  const key=fixture.data.instrument.instrumentKey;
  const e=engine({account:{positions:{[key]:{quantity:3,costBasisPaise:10001,averagePricePaise:3334,investedValuePaise:10001,reservedQuantity:0}}}});
  const order=e.submitOrder({idempotencyKey:"odd-basis-sell-01",instrumentKey:key,side:"SELL",orderType:"MARKET",product:"DELIVERY",quantity:3});
  const first=e.matchNext(order.orderId),last=e.matchNext(order.orderId);
  assert.deepEqual([first.fill.quantity,last.fill.quantity],[2,1]);
  assert.equal(first.fill.realizedPnlPaise+last.fill.realizedPnlPaise,374800-10001);
  assert.equal(last.order.status,"FILLED");
  assert.equal(e.snapshot().account.positions[key],undefined);
  assert.equal(e.snapshot().account.realizedPnlPaise,374800-10001);
});

test("browser build exposes the same engine without Node globals and can execute synthetic fills",()=>{
  const source=fs.readFileSync(path.join(__dirname,"../lib/equity-demo-execution-engine.js"),"utf8");
  const sandbox={window:{}};
  vm.runInNewContext(source,sandbox,{filename:"equity-demo-execution-engine.browser.js"});
  const api=sandbox.window.ZenuraEquityDemoEngine;
  assert.equal(typeof api.createEquityDemoExecutionEngine,"function");
  const browserEngine=api.createEquityDemoExecutionEngine({fixture,account:accountFixture.data,env:{NODE_ENV:"development"}});
  const order=browserEngine.submitOrder(buy({quantity:5,idempotencyKey:"browser-demo-0001"}));
  const first=browserEngine.matchNext(order.orderId);
  assert.equal(first.fill.quantity,2);
  assert.equal(first.order.status,"PARTIALLY_FILLED");
  assert.equal(browserEngine.snapshot().account.positions[fixture.data.instrument.instrumentKey].quantity,2);
});
test("canonical 15-screen Demo mounts the shared Equity engine and responsive panel",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../../markets/stocks/demo.html"),"utf8");
  const js=fs.readFileSync(path.join(__dirname,"../../markets/stocks/demo.js"),"utf8");
  const panel=fs.readFileSync(path.join(__dirname,"../../markets/stocks/demo-equity-panel.mjs"),"utf8");
  const css=fs.readFileSync(path.join(__dirname,"../../markets/stocks/demo.css"),"utf8");
  assert.match(html,/equity-demo-execution-engine\.js/);
  assert.match(html,/DEMO DATA · SYNTHETIC FIXTURES/);
  assert.match(js,/mountEquityDemo\(content\)/);
  assert.match(js,/appendUnifiedLedgerSummary\(content,name\)/);
  assert.ok(panel.includes("../../market-gateway/mock/fixtures/equity-execution.json"));
  assert.ok(panel.includes("../../market-gateway/mock/fixtures/account.json"));
  assert.match(panel,/submitOrder/);
  assert.match(panel,/matchNext/);
  assert.match(panel,/cancelOrder/);
  assert.match(panel,/wallet reconciliation remains false/);
  assert.match(css,/@media\(max-width:900px\)/);
  assert.match(css,/@media\(max-width:520px\)/);
});


test("position quantity and BUY cost-basis boundaries reject atomically",()=>{
  const key=fixture.data.instrument.instrumentKey;
  assert.throws(()=>engine({account:{positions:{[key]:{quantity:1000001,costBasisPaise:1,reservedQuantity:0}}}}),/INVALID_EQUITY_DEMO_POSITION/);
  const e=engine({account:{positions:{[key]:{quantity:1000000,costBasisPaise:1000000,reservedQuantity:0}}}});
  const order=e.submitOrder(buy({idempotencyKey:"boundary-buy-qty-01",quantity:1}));
  const before=e.snapshot();
  assert.throws(()=>e.matchNext(order.orderId),/DEMO_POSITION_QUANTITY_LIMIT/);
  assert.deepEqual(e.snapshot(),before);
});

test("SELL realized-P&L overflow rejects before cash, position, depth or receipt mutation",()=>{
  const key=fixture.data.instrument.instrumentKey;
  const e=engine({account:{
    // Initial total P&L is exactly MIN_SAFE_INTEGER: +20 unrealized offsets realized P&L.
    realizedPnlPaise:Number.MIN_SAFE_INTEGER+20,
    positions:{[key]:{quantity:2,costBasisPaise:250080,averagePricePaise:125040,reservedQuantity:0}}
  }});
  const order=e.submitOrder({idempotencyKey:"boundary-sell-pnl-01",instrumentKey:key,side:"SELL",orderType:"MARKET",product:"DELIVERY",quantity:1});
  const before=e.snapshot();
  assert.throws(()=>e.matchNext(order.orderId),/DEMO_AMOUNT_OUT_OF_RANGE/);
  assert.deepEqual(e.snapshot(),before);
  assert.equal(e.getFillReceipts(order.orderId).length,0);
});

test("unsafe account P&L is rejected instead of silently reset",()=>{
  assert.throws(()=>engine({account:{realizedPnlPaise:Number.MAX_SAFE_INTEGER+1}}),/INVALID_EQUITY_DEMO_ACCOUNT/);
});
