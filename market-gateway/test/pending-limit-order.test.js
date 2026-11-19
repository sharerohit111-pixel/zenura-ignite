"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {evaluatePendingLimitOrder,DEFAULT_MAX_QUOTE_AGE_MS}=require("../lib/pending-limit-order");

const nowMs=1700000000000;
const order={orderId:"paper-limit-1",instrumentKey:"NSE_EQ|INE009A01021",orderType:"LIMIT",status:"PENDING",simulationOnly:true,side:"BUY",quantity:3,limitPricePaise:12500};
const quote=(pricePaise,timestampMs=nowMs-1000)=>({pricePaise,timestampMs});

test("BUY limit is eligible only at or below its limit using a fresh quote",()=>{
  assert.deepEqual(evaluatePendingLimitOrder({order,quote:quote(12400),nowMs}),{
    eligible:true,executionPricePaise:12400,quoteTimestampMs:nowMs-1000,quoteAgeMs:1000
  });
  assert.equal(evaluatePendingLimitOrder({order,quote:quote(12500),nowMs}).eligible,true);
  assert.deepEqual(evaluatePendingLimitOrder({order,quote:quote(12501),nowMs}),{eligible:false,reason:"LIMIT_NOT_REACHED"});
});

test("SELL limit is eligible only at or above its limit",()=>{
  const sell={...order,side:"SELL"};
  assert.equal(evaluatePendingLimitOrder({order:sell,quote:quote(12500),nowMs}).eligible,true);
  assert.equal(evaluatePendingLimitOrder({order:sell,quote:quote(12600),nowMs}).executionPricePaise,12600);
  assert.deepEqual(evaluatePendingLimitOrder({order:sell,quote:quote(12499),nowMs}),{eligible:false,reason:"LIMIT_NOT_REACHED"});
});

test("invalid, stale and future quotes can never trigger execution",()=>{
  assert.deepEqual(evaluatePendingLimitOrder({order,quote:null,nowMs}),{eligible:false,reason:"INVALID_QUOTE"});
  assert.deepEqual(evaluatePendingLimitOrder({order,quote:quote(12000,nowMs-DEFAULT_MAX_QUOTE_AGE_MS-1),nowMs}),{eligible:false,reason:"STALE_QUOTE"});
  assert.deepEqual(evaluatePendingLimitOrder({order,quote:quote(12000,nowMs+1),nowMs}),{eligible:false,reason:"FUTURE_QUOTE"});
  assert.deepEqual(evaluatePendingLimitOrder({order,quote:quote(0),nowMs}),{eligible:false,reason:"INVALID_QUOTE"});
});

test("only pending simulation LIMIT orders with valid order fields are evaluated",()=>{
  for(const patch of [
    {orderType:"MARKET"},{status:"FILLED"},{status:"CANCELLED"},{simulationOnly:false},
    {side:"HOLD"},{quantity:0},{quantity:1000001},{limitPricePaise:0},{limitPricePaise:1.5},
    {instrumentKey:""}
  ]) assert.throws(()=>evaluatePendingLimitOrder({order:{...order,...patch},quote:quote(12000),nowMs}),{status:409});
});

test("invalid evaluation clock is rejected rather than weakening quote freshness",()=>{
  assert.throws(()=>evaluatePendingLimitOrder({order,quote:quote(12000),nowMs:0}),{status:500});
  assert.throws(()=>evaluatePendingLimitOrder({order,quote:quote(12000),nowMs,maxQuoteAgeMs:0}),{status:500});
});
