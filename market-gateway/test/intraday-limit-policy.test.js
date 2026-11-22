"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {marketClockParts,isIntradaySessionOpen,isIntradayOrderExpired,isEligibleIntradayLimitOrder}=require("../lib/intraday-limit-policy");

const epoch=iso=>Date.parse(iso);
const order={order_type:"LIMIT",status:"PENDING",simulation_only:true,product:"INTRADAY",
 user_id:"11111111-1111-4111-8111-111111111111",instrument_key:"NSE_EQ|TEST",
 side:"BUY",quantity:10,limit_price_paise:10000,created_at:"2026-11-23T04:00:00.000Z"};
const quote={pricePaise:9900,tradeTimeMs:epoch("2026-11-23T04:30:00.000Z")};

test("market clock uses Indian Standard Time and handles midnight correctly",()=>{
 assert.deepEqual(marketClockParts(epoch("2026-11-23T03:45:00.000Z")),{weekday:"Mon",year:2026,month:11,day:23,hour:9,minute:15,second:0});
 assert.equal(marketClockParts(epoch("2026-11-23T18:30:00.000Z")).hour,0);
});
test("intraday session requires an explicit exchange trading-day decision",()=>{
 assert.equal(isIntradaySessionOpen(epoch("2026-11-23T03:45:00.000Z")),false);
 assert.equal(isIntradaySessionOpen(epoch("2026-11-23T03:45:00.000Z"),{isTradingDay:true}),true);
 assert.equal(isIntradaySessionOpen(epoch("2026-11-23T03:44:59.000Z"),{isTradingDay:true}),false);
 assert.equal(isIntradaySessionOpen(epoch("2026-11-23T10:00:00.000Z"),{isTradingDay:true}),false);
 assert.equal(isIntradaySessionOpen(epoch("2026-11-22T04:30:00.000Z"),{isTradingDay:true}),false);
 assert.equal(isIntradaySessionOpen(epoch("2026-11-23T03:45:00.000Z"),{isTradingDay:false}),false);
});
test("intraday LIMIT eligibility requires fresh quote, active session and exact side threshold",()=>{
 const now=epoch("2026-11-23T04:30:01.000Z");
 assert.equal(isEligibleIntradayLimitOrder(order,quote,now,{isTradingDay:true}),true);
 assert.equal(isEligibleIntradayLimitOrder({...order,side:"SELL"},quote,now,{isTradingDay:true}),false);
 assert.equal(isEligibleIntradayLimitOrder({...order,side:"SELL",limit_price_paise:9800},quote,now,{isTradingDay:true}),true);
 assert.equal(isEligibleIntradayLimitOrder(order,{...quote,tradeTimeMs:now-15001},now,{isTradingDay:true}),false);
 assert.equal(isEligibleIntradayLimitOrder(order,quote,now,{isTradingDay:false}),false);
 assert.equal(isEligibleIntradayLimitOrder({...order,product:"DELIVERY"},quote,now,{isTradingDay:true}),false);
 assert.equal(isEligibleIntradayLimitOrder({...order,simulation_only:false},quote,now,{isTradingDay:true}),false);
});
test("intraday pending orders expire at 15:30 IST and never carry to another session",()=>{
 assert.equal(isIntradayOrderExpired(order,epoch("2026-11-23T09:59:59.000Z"),{isTradingDay:true}),false);
 assert.equal(isIntradayOrderExpired(order,epoch("2026-11-23T10:00:00.000Z"),{isTradingDay:true}),true);
 assert.equal(isIntradayOrderExpired(order,epoch("2026-11-24T04:00:00.000Z"),{isTradingDay:true}),true);
 assert.equal(isIntradayOrderExpired({...order,product:"DELIVERY"},epoch("2026-11-23T10:00:00.000Z"),{isTradingDay:true}),false);
});
test("malformed timestamps and non-pending orders fail closed",()=>{
 assert.throws(()=>marketClockParts(NaN),TypeError);
 assert.equal(isIntradayOrderExpired({...order,created_at:"bad"},epoch("2026-11-23T10:00:00.000Z")),false);
 assert.equal(isEligibleIntradayLimitOrder({...order,status:"CANCELLED"},quote,epoch("2026-11-23T04:30:01.000Z"),{isTradingDay:true}),false);
});
