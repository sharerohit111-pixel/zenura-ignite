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
 const derivatives={orders:[{orderId:"MOCK-FO-000001",assetClass:"FUTURE",side:"SELL",orderType:"MARKET",product:"INTRADAY",instrumentKey:"MOCK|NSE|FUT|0001",quantity:2,filledQuantity:2,remainingQuantity:0,status:"FILLED",createdAt:"2026-11-25T09:16:00.000Z",updatedAt:"2026-11-25T09:16:01.000Z",fills:[{fillId:"fo-fill-1",quantity:2,pricePaise:250000,executedAt:"2026-11-25T09:16:01.000Z"}]}]};
 const combined=sync("DERIVATIVES",derivatives);
 assert.equal(combined.orders.length,2);assert.equal(combined.trades.length,2);
 assert.equal(combined.positions.find(p=>p.assetClass==="FUTURE").quantity,-2);
 assert.deepEqual(history.createDemoTradeHistoryStore({env:{NODE_ENV:"test"}}).replay([]),{mode:"DEMO",provider:"DUMMY_JSON",simulationOnly:true,orders:[],openOrders:[],trades:[],positions:[],events:[]});
});
