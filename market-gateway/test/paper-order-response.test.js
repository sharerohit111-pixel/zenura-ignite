"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {publicPaperOrder}=require("../lib/paper-order-response");
test("public paper order response excludes private identity and idempotency fields",()=>{
 const response=publicPaperOrder({uid:"private-uid",requestFingerprint:"secret",tradingSymbol:"ABC",exchange:"NSE",side:"BUY",quantity:2,product:"INTRADAY",executionPricePaise:1234,grossPaise:2468,orderType:"MARKET",status:"FILLED",simulationOnly:true,createdAt:{toMillis:()=>123456}},{orderId:"order-1",cashPaise:5000,realizedPnlTotalPaise:-10,idempotentReplay:true});
 assert.equal(response.orderId,"order-1");assert.equal(response.createdAt,123456);assert.equal(response.orderType,"MARKET");assert.equal(response.product,"INTRADAY");assert.equal(response.exchange,"NSE");assert.equal(response.cashPaise,5000);assert.equal(response.realizedPnlTotalPaise,-10);assert.equal(response.idempotentReplay,true);
 assert.equal("uid" in response,false);assert.equal("requestFingerprint" in response,false);
});
test("response handles absent optional data safely",()=>{
 const response=publicPaperOrder({side:"SELL"},{orderId:"order-2"});
 assert.equal(response.cashPaise,null);assert.equal(response.createdAt,null);assert.equal(response.realizedPnlTotalPaise,0);
});
