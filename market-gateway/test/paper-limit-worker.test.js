"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {isEligiblePaperLimitOrder,normalizeWorkerCursor,groupOrdersByUser}=require("../lib/paper-limit-worker");

const base={order_type:"LIMIT",status:"PENDING",simulation_only:true,product:"DELIVERY",exchange:"NSE",
 user_id:"11111111-1111-4111-8111-111111111111",instrument_key:"NSE_EQ|TEST",
 side:"BUY",quantity:10,limit_price_paise:10000};
const quote={pricePaise:9900,tradeTimeMs:100000,quoteAgeMs:1000};

test("LIMIT worker fills only matching fresh, pending, simulation-only delivery orders",()=>{
 assert.equal(isEligiblePaperLimitOrder(base,quote,101000),true);
 assert.equal(isEligiblePaperLimitOrder({...base,side:"SELL"},quote,101000),false);
 assert.equal(isEligiblePaperLimitOrder({...base,side:"SELL",limit_price_paise:9800},quote,101000),true);
 assert.equal(isEligiblePaperLimitOrder({...base,status:"CANCELLED"},quote,101000),false);
 assert.equal(isEligiblePaperLimitOrder({...base,simulation_only:false},quote,101000),false);
 assert.equal(isEligiblePaperLimitOrder({...base,product:"INTRADAY"},quote,101000),false);
 const bseOrder={...base,exchange:"BSE",instrument_key:"BSE_EQ|INE002A01018"};
 assert.equal(isEligiblePaperLimitOrder(bseOrder,quote,101000),true);
 assert.equal(isEligiblePaperLimitOrder({...bseOrder,instrument_key:"NSE_EQ|INE002A01018"},quote,101000),false);
});
test("LIMIT worker rejects stale, future-dated and malformed quotes",()=>{
 assert.equal(isEligiblePaperLimitOrder(base,{...quote,tradeTimeMs:85000},101000),false);
 assert.equal(isEligiblePaperLimitOrder(base,{...quote,tradeTimeMs:101001},101000),false);
 assert.equal(isEligiblePaperLimitOrder(base,{...quote,pricePaise:0},101000),false);
 assert.equal(isEligiblePaperLimitOrder(base,{...quote,tradeTimeMs:NaN},101000),false);
});
test("LIMIT worker cursor is reset unless both ordered cursor fields are valid",()=>{
 assert.deepEqual(normalizeWorkerCursor({cursor_created_at:"2026-11-22T10:00:00.000Z",cursor_order_id:"a".repeat(64)}),
  {createdAt:"2026-11-22T10:00:00.000Z",orderId:"a".repeat(64)});
 assert.deepEqual(normalizeWorkerCursor({cursor_created_at:"bad",cursor_order_id:"a".repeat(64)}),{createdAt:null,orderId:null});
});
test("LIMIT worker groups pending orders by verified user id",()=>{
 const groups=groupOrdersByUser([base,{...base,order_id:"b".repeat(64)},{...base,user_id:"22222222-2222-4222-8222-222222222222"},{...base,user_id:null}]);
 assert.equal(groups.size,2);
 assert.equal(groups.get(base.user_id).length,2);
});
