"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const history=require("../lib/demo-trade-history-store");
global.window={ZenuraDemoTradeHistory:history};
let sync;
test("Equity and Futures events share one idempotent projection",async()=>{
 if(!sync){({syncDemoProjection:sync}=await import("../../markets/stocks/demo-trade-projection.mjs"));}
 const equity={orders:[{orderId:"DEMO-EQ-eq-0001",side:"BUY",orderType:"MARKET",product:"DELIVERY",instrumentKey:"MOCK|NSE|EQ|0001",quantity:5,filledQuantity:2,remainingQuantity:3,status:"PARTIALLY_FILLED",createdAt:"2026-11-25T09:15:00.000Z",updatedAt:"2026-11-25T09:15:01.000Z"}],
  fills:[{fillId:"eq-fill-1",orderId:"DEMO-EQ-eq-0001",quantity:2,pricePaise:125000,filledAt:"2026-11-25T09:15:01.000Z"}]};
 const first=sync("EQUITY",equity),second=sync("EQUITY",equity);
 assert.deepEqual(second.orders,first.orders);assert.equal(second.trades.length,1);
 const interleaved={orders:[
  {orderId:"DEMO-EQ-sell-0001",side:"SELL",orderType:"MARKET",product:"DELIVERY",instrumentKey:"MOCK|NSE|EQ|0001",quantity:1,filledQuantity:1,remainingQuantity:0,status:"FILLED",createdAt:"2026-11-25T09:15:01.500Z",updatedAt:"2026-11-25T09:15:02.000Z"},
  {orderId:"DEMO-EQ-eq-0001",side:"BUY",orderType:"MARKET",product:"DELIVERY",instrumentKey:"MOCK|NSE|EQ|0001",quantity:5,filledQuantity:4,remainingQuantity:1,status:"PARTIALLY_FILLED",createdAt:"2026-11-25T09:15:00.000Z",updatedAt:"2026-11-25T09:15:03.000Z"}
 ],
 fills:[
  {fillId:"eq-fill-1",orderId:"DEMO-EQ-eq-0001",quantity:2,pricePaise:125000,filledAt:"2026-11-25T09:15:01.000Z"},
  {fillId:"eq-sell-fill-1",orderId:"DEMO-EQ-sell-0001",quantity:1,pricePaise:130000,filledAt:"2026-11-25T09:15:02.000Z"},
  {fillId:"eq-fill-2",orderId:"DEMO-EQ-eq-0001",quantity:2,pricePaise:120000,filledAt:"2026-11-25T09:15:03.000Z"}
 ]};
 const interleavedProjection=sync("EQUITY",interleaved);
 const equityPosition=interleavedProjection.positions.find(p=>p.assetClass==="EQUITY");
 assert.equal(equityPosition.quantity,3);
 assert.equal(equityPosition.costBasisPaise,365000);
 assert.equal(equityPosition.realizedPnlPaise,5000);
 const derivatives={orders:[{orderId:"MOCK-FO-000001",assetClass:"FUTURE",side:"SELL",orderType:"MARKET",product:"INTRADAY",instrumentKey:"MOCK|NSE|FUT|0001",quantity:2,filledQuantity:2,remainingQuantity:0,status:"FILLED",createdAt:"2026-11-25T09:16:00.000Z",updatedAt:"2026-11-25T09:16:01.000Z",fills:[{fillId:"fo-fill-1",quantity:2,pricePaise:250000,executedAt:"2026-11-25T09:16:01.000Z"}]}]};
 const rejected={orders:[{orderId:"MOCK-FO-000002",assetClass:"OPTION",side:"BUY",orderType:"MARKET",product:"DELIVERY",instrumentKey:"MOCK|NSE|OPT|0001",quantity:25,filledQuantity:0,remainingQuantity:25,status:"REJECTED",rejectionReason:"Insufficient deterministic depth",createdAt:"2026-11-25T09:17:00.000Z",updatedAt:"2026-11-25T09:17:00.000Z",fills:[]}]};
 const rejectedProjection=sync("DERIVATIVES",rejected);
 assert.equal(rejectedProjection.orders.find(o=>o.orderId==="MOCK-FO-000002").status,"REJECTED");
 assert.equal(rejectedProjection.orders.find(o=>o.orderId==="MOCK-FO-000002").rejectionReason,"Insufficient deterministic depth");
 const combined=sync("DERIVATIVES",derivatives);
 assert.equal(combined.orders.length,4);assert.equal(combined.trades.length,4);
 assert.equal(combined.positions.find(p=>p.assetClass==="FUTURE").quantity,-2);
 assert.deepEqual(history.createDemoTradeHistoryStore({env:{NODE_ENV:"test"}}).replay([]),{mode:"DEMO",provider:"DUMMY_JSON",simulationOnly:true,orders:[],openOrders:[],trades:[],positions:[],events:[]});
});

test("shared event projection reconciles Futures realized and synthetic unrealized P&L by product",async()=>{
 if(!sync){({syncDemoProjection:sync}=await import("../../markets/stocks/demo-trade-projection.mjs"));}
 const key="MOCK|NSE|FUT|MOCKBANK|2026-12-31";
 const snapshot={orders:[
  {orderId:"MOCK-FO-PNL-BUY",assetClass:"FUTURE",side:"BUY",orderType:"MARKET",product:"INTRADAY",instrumentKey:key,quantity:50,filledQuantity:50,remainingQuantity:0,status:"FILLED",createdAt:"2026-11-25T10:00:00.000Z",updatedAt:"2026-11-25T10:00:01.000Z",fills:[{fillId:"mock-pnl-buy-fill",quantity:50,pricePaise:2500050,executedAt:"2026-11-25T10:00:01.000Z"}]},
  {orderId:"MOCK-FO-PNL-SELL",assetClass:"FUTURE",side:"SELL",orderType:"MARKET",product:"INTRADAY",instrumentKey:key,quantity:25,filledQuantity:25,remainingQuantity:0,status:"FILLED",createdAt:"2026-11-25T10:00:02.000Z",updatedAt:"2026-11-25T10:00:03.000Z",fills:[{fillId:"mock-pnl-sell-fill",quantity:25,pricePaise:2500000,executedAt:"2026-11-25T10:00:03.000Z"}]}
 ],positions:[{instrumentKey:key,product:"INTRADAY",markPricePaise:2500000,unrealizedPnlPaise:-1250,markSource:"SYNTHETIC_FIXTURE"}]};
 const result=sync("DERIVATIVES",snapshot);
 const position=result.positions.find(item=>item.instrumentKey===key&&item.product==="INTRADAY");
 assert.equal(position.quantity,25);
 assert.equal(position.realizedPnlPaise,-1250);
 assert.equal(position.markPricePaise,2500000);
 assert.equal(position.unrealizedPnlPaise,-1250);
 assert.equal(position.totalPnlPaise,-2500);
});
