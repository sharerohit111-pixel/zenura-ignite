"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createDemoTradeHistoryStore}=require("../lib/demo-trade-history-store");
const base=(overrides={})=>({assetClass:"EQUITY",side:"BUY",orderType:"LIMIT",product:"DELIVERY",
  instrumentKey:"MOCK|NSE|EQ|0001",quantity:5,limitPricePaise:125000,
  idempotencyKey:"history-order-0001",createdAt:"2026-11-24T09:30:00+05:30",...overrides});
const fill=(orderId,overrides={})=>({orderId,fillId:"fill-0001",quantity:2,pricePaise:124950,
  filledAt:"2026-11-24T09:30:01+05:30",...overrides});

test("one order projection feeds order book, open orders, trades and positions",()=>{
  const store=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}});
  const order=store.submit(base());
  const result=store.recordFill(fill(order.orderId));
  const s=store.snapshot();
  assert.equal(result.order.status,"PARTIALLY_FILLED");
  assert.equal(s.orders.length,1);assert.equal(s.openOrders.length,1);assert.equal(s.trades.length,1);
  assert.equal(s.positions[0].quantity,2);assert.equal(s.positions[0].costBasisPaise,249900);
  assert.equal(s.positions[0].averagePricePaise,124950);
});

test("duplicate order submission is idempotent and payload mismatch is rejected",()=>{
  const store=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}});
  const a=store.submit(base()),b=store.submit(base());
  assert.deepEqual(a,b);assert.equal(store.snapshot().orders.length,1);
  assert.throws(()=>store.submit(base({quantity:6})),/DEMO_IDEMPOTENCY_KEY_REUSED/);
});

test("duplicate fill replay returns original receipt and never double counts position",()=>{
  const store=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}});
  const order=store.submit(base());
  const first=store.recordFill(fill(order.orderId));
  const second=store.recordFill(fill(order.orderId));
  assert.equal(second.duplicate,true);assert.deepEqual(second.trade,first.trade);
  assert.equal(store.snapshot().trades.length,1);assert.equal(store.snapshot().positions[0].quantity,2);
  assert.throws(()=>store.recordFill(fill(order.orderId,{quantity:3})),/DEMO_FILL_ID_REUSED/);
});

test("partial fills followed by cancellation retain receipts and executed position",()=>{
  const store=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}});
  const order=store.submit(base());
  store.recordFill(fill(order.orderId));
  const cancelled=store.cancel(order.orderId,"2026-11-24T09:30:02+05:30");
  const s=store.snapshot();
  assert.equal(cancelled.order.status,"CANCELLED");assert.equal(cancelled.order.filledQuantity,2);
  assert.equal(cancelled.order.remainingQuantity,3);assert.equal(s.trades.length,1);
  assert.equal(s.openOrders.length,0);assert.equal(s.positions[0].quantity,2);
  assert.equal(store.cancel(order.orderId,"2026-11-24T09:30:03+05:30").duplicate,true);
});

test("sell fills close long positions and compute deterministic realized P&L",()=>{
  const store=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}});
  const buyOrder=store.submit(base({quantity:3,limitPricePaise:120000,idempotencyKey:"history-buy-0001"}));
  store.recordFill(fill(buyOrder.orderId,{fillId:"buy-fill-1",quantity:3,pricePaise:120000}));
  const sellOrder=store.submit(base({side:"SELL",quantity:1,limitPricePaise:125000,idempotencyKey:"history-sell-001"}));
  store.recordFill(fill(sellOrder.orderId,{fillId:"sell-fill-1",quantity:1,pricePaise:125000}));
  const p=store.snapshot().positions[0];
  assert.equal(p.quantity,2);assert.equal(p.costBasisPaise,240000);assert.equal(p.realizedPnlPaise,5000);
  const oversell=store.submit(base({side:"SELL",quantity:2,limitPricePaise:125000,idempotencyKey:"history-sell-002"}));
  assert.throws(()=>store.recordFill(fill(oversell.orderId,{fillId:"sell-fill-2",quantity:2,pricePaise:125000})),/DEMO_POSITION_SELL_EXCEEDS_LONG/);
});

test("event replay is deterministic and detached snapshots cannot mutate store",()=>{
  const a=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}});
  const o=a.submit(base());a.recordFill(fill(o.orderId));
  a.cancel(o.orderId,"2026-11-24T09:30:02+05:30");
  const first=a.snapshot(),replayed=a.replay(a.exportEvents());
  assert.deepEqual(replayed,first);
  first.orders[0].status="FILLED";first.trades[0].quantity=999;
  assert.equal(a.snapshot().orders[0].status,"CANCELLED");
  assert.equal(a.snapshot().trades[0].quantity,2);
});

test("production environment and non-MOCK instruments fail closed",()=>{
  assert.throws(()=>createDemoTradeHistoryStore({env:{NODE_ENV:"production"}}),/DEMO_HISTORY_DISABLED_IN_PRODUCTION/);
  const store=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}});
  assert.throws(()=>store.submit(base({instrumentKey:"NSE|EQ|123"})),/INVALID_DEMO_ORDER/);
});
