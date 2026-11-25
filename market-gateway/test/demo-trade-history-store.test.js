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
  assert.equal(store.cancel(order.orderId,"2026-11-24T09:30:02+05:30").duplicate,true);
});

test("sell fills close long positions and compute deterministic realized P&L",()=>{
  const store=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}});
  const buyOrder=store.submit(base({quantity:3,limitPricePaise:120000,idempotencyKey:"history-buy-0001"}));
  store.recordFill(fill(buyOrder.orderId,{fillId:"buy-fill-1",quantity:3,pricePaise:120000}));
  const sellOrder=store.submit(base({side:"SELL",quantity:1,limitPricePaise:125000,idempotencyKey:"history-sell-001",createdAt:"2026-11-24T09:30:02+05:30"}));
  store.recordFill(fill(sellOrder.orderId,{fillId:"sell-fill-1",quantity:1,pricePaise:125000,filledAt:"2026-11-24T09:30:03+05:30"}));
  const p=store.snapshot().positions[0];
  assert.equal(p.quantity,2);assert.equal(p.costBasisPaise,240000);assert.equal(p.realizedPnlPaise,5000);
  const oversell=store.submit(base({side:"SELL",quantity:3,limitPricePaise:125000,idempotencyKey:"history-sell-002",createdAt:"2026-11-24T09:30:04+05:30"}));
  assert.throws(()=>store.recordFill(fill(oversell.orderId,{fillId:"sell-fill-2",quantity:3,pricePaise:125000,filledAt:"2026-11-24T09:30:05+05:30"})),/DEMO_POSITION_SELL_EXCEEDS_LONG/);
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

test("Futures SELL can open a deterministic short position while option/equity remain long-only",()=>{
 const s=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}});
 const o=s.submit(base({assetClass:"FUTURE",side:"SELL",quantity:2,idempotencyKey:"future-short-01"}));
 s.recordFill(fill(o.orderId,{fillId:"future-short-fill",quantity:2,pricePaise:250000}));
 const p=s.snapshot().positions[0];assert.equal(p.quantity,-2);assert.equal(p.averagePricePaise,250000);
});

test("rejected orders remain visible and replay with their reason",()=>{
 const s=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}});
 const o=s.submit(base({idempotencyKey:"reject-order-001"}));
 s.reject(o.orderId,"Insufficient deterministic depth","2026-11-24T09:30:02+05:30");
 assert.equal(s.snapshot().orders[0].status,"REJECTED");
 assert.equal(s.snapshot().orders[0].rejectionReason,"Insufficient deterministic depth");
 assert.deepEqual(s.replay(s.exportEvents()),s.snapshot());
 assert.equal(s.reject(o.orderId,"Insufficient deterministic depth","2026-11-24T09:30:02+05:30").duplicate,true);
});


test("multiple partial fills accumulate once, reach FILLED and replay with a strict sequence",()=>{
 const s=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}});
 const o=s.submit(base());
 const first=fill(o.orderId,{fillId:"multi-fill-001",quantity:2,pricePaise:124950});
 const second=fill(o.orderId,{fillId:"multi-fill-002",quantity:1,pricePaise:125050,filledAt:"2026-11-24T09:30:02+05:30"});
 const third=fill(o.orderId,{fillId:"multi-fill-003",quantity:2,pricePaise:125150,filledAt:"2026-11-24T09:30:03+05:30"});
 assert.equal(s.recordFill(first).order.status,"PARTIALLY_FILLED");
 assert.equal(s.recordFill(second).order.status,"PARTIALLY_FILLED");
 const final=s.recordFill(third);
 assert.equal(final.order.status,"FILLED");
 assert.equal(final.order.filledQuantity,5);
 assert.equal(final.order.remainingQuantity,0);
 assert.equal(final.order.grossValuePaise,625250);
 assert.equal(final.order.averagePricePaise,125050);
 assert.equal(s.recordFill(third).duplicate,true);
 assert.equal(s.cancel(o.orderId,"2026-11-24T09:30:04+05:30").cancelled,false);
 const log=s.exportEvents();
 assert.deepEqual(log.map(e=>e.sequence),[1,2,3,4]);
 assert.deepEqual(s.replay(log),s.snapshot());
});

test("cancelled remainder cannot receive a late fill and lifecycle timestamps cannot move backwards",()=>{
 const s=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}});
 const o=s.submit(base());
 s.recordFill(fill(o.orderId,{fillId:"before-cancel",quantity:2}));
 s.cancel(o.orderId,"2026-11-24T09:30:02+05:30");
 assert.throws(()=>s.recordFill(fill(o.orderId,{fillId:"late-fill",quantity:1,filledAt:"2026-11-24T09:30:03+05:30"})),/DEMO_FILL_EXCEEDS_REMAINING/);
 assert.throws(()=>s.cancel(o.orderId,"2026-11-24T09:30:01+05:30"),/DEMO_CANCELLATION_RETRY_MISMATCH/);
 assert.throws(()=>s.replay(s.exportEvents().map((e,i)=>({...e,sequence:i+2}))),/DEMO_EVENT_SEQUENCE_MISMATCH/);
 const reversed=s.exportEvents().map(e=>({...e}));
 reversed[2].occurredAt="2026-11-24T09:29:59+05:30";
 assert.throws(()=>s.replay(reversed),/DEMO_ORDER_TIME_ORDER_MISMATCH/);
});

test("rejection is terminal, timestamped, idempotent only for the same rejection and replayable",()=>{
 const s=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}});
 const o=s.submit(base({idempotencyKey:"reject-lifecycle-01"}));
 const at="2026-11-24T09:30:02+05:30";
 assert.equal(s.reject(o.orderId,"synthetic rejection",at).duplicate,false);
 assert.equal(s.reject(o.orderId,"synthetic rejection",at).duplicate,true);
 assert.throws(()=>s.reject(o.orderId,"different reason",at),/DEMO_REJECTION_RETRY_MISMATCH/);
 assert.throws(()=>s.recordFill(fill(o.orderId,{fillId:"after-reject",filledAt:"2026-11-24T09:30:03+05:30"})),/DEMO_FILL_EXCEEDS_REMAINING/);
 assert.deepEqual(s.replay(s.exportEvents()),s.snapshot());
});

test("malformed non-ISO timestamps fail closed before mutating lifecycle state",()=>{
 const s=createDemoTradeHistoryStore({env:{NODE_ENV:"test"}});
 assert.throws(()=>s.submit(base({createdAt:"tomorrow"})),/INVALID_DEMO_ORDER/);
 const o=s.submit(base());
 assert.throws(()=>s.recordFill(fill(o.orderId,{fillId:"bad-time",filledAt:"2026-11-24"})),/INVALID_DEMO_FILL/);
 assert.equal(s.snapshot().orders[0].status,"PENDING");
 assert.equal(s.exportEvents().length,1);
});
