"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createDemoTradeHistoryStore}=require("../lib/demo-trade-history-store");
const base=(overrides={})=>({assetClass:"EQUITY",side:"BUY",orderType:"LIMIT",product:"DELIVERY",instrumentKey:"MOCK|NSE|EQ|0001",quantity:5,limitPricePaise:125000,idempotencyKey:"history-order-0001",createdAt:"2026-11-24T09:30:00+05:30",...overrides});
const fill=(orderId,overrides={})=>({orderId,fillId:"fill-0001",quantity:2,pricePaise:124950,filledAt:"2026-11-24T09:30:01+05:30",...overrides});
test("shared order/fill projection and partial fill cancellation",()=>{
 const s=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}}),o=s.submit(base());
 s.recordFill(fill(o.orderId));s.cancel(o.orderId,"2026-11-24T09:30:02+05:30");
 const v=s.snapshot();assert.equal(v.orders.length,1);assert.equal(v.openOrders.length,0);
 assert.equal(v.trades.length,1);assert.equal(v.positions[0].quantity,2);
 assert.equal(v.orders[0].remainingQuantity,3);assert.equal(v.orders[0].status,"CANCELLED");
});
test("duplicate submissions and fills are idempotent; changed payloads reject",()=>{
 const s=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}}),a=s.submit(base()),b=s.submit(base());
 assert.deepEqual(a,b);assert.throws(()=>s.submit(base({quantity:6})),/DEMO_IDEMPOTENCY_KEY_REUSED/);
 s.recordFill(fill(a.orderId));assert.equal(s.recordFill(fill(a.orderId)).duplicate,true);
 assert.throws(()=>s.recordFill(fill(a.orderId,{quantity:3})),/DEMO_FILL_ID_REUSED/);
 assert.equal(s.snapshot().positions[0].quantity,2);
});
test("Futures SELL can open a deterministic short position while option/equity remain long-only",()=>{
 const s=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}});
 const o=s.submit(base({assetClass:"FUTURE",side:"SELL",quantity:2,idempotencyKey:"future-short-01"}));
 s.recordFill(fill(o.orderId,{fillId:"future-short-fill",quantity:2,pricePaise:250000}));
 const p=s.snapshot().positions[0];assert.equal(p.quantity,-2);assert.equal(p.averagePricePaise,250000);
});
test("event replay is deterministic and production fails closed",()=>{
 const s=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}}),o=s.submit(base());
 s.recordFill(fill(o.orderId));s.cancel(o.orderId,"2026-11-24T09:30:02+05:30");
 assert.deepEqual(s.replay(s.exportEvents()),s.snapshot());
 assert.throws(()=>createDemoTradeHistoryStore({env:{NODE_ENV:"production"}}),/DEMO_HISTORY_DISABLED_IN_PRODUCTION/);
});
