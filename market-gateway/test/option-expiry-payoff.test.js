"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {calculateOptionExpiryPayoff}=require("../lib/option-expiry-payoff");
test("long call computes expiry intrinsic value, premium and break-even",()=>{
 const r=calculateOptionExpiryPayoff({optionType:"CE",strikePricePaise:2500000,premiumPaise:10000,underlyingPricePaise:2530000,lots:2,lotSize:65});
 assert.equal(r.quantity,130);assert.equal(r.intrinsicTotalPaise,3900000);assert.equal(r.premiumTotalPaise,1300000);assert.equal(r.grossPnlPaise,2600000);assert.equal(r.breakEvenPricePaise,2510000);
});
test("long put computes expiry intrinsic value and break-even",()=>{
 const r=calculateOptionExpiryPayoff({optionType:"PE",strikePricePaise:2500000,premiumPaise:12000,underlyingPricePaise:2470000,lots:1,lotSize:65});
 assert.equal(r.intrinsicTotalPaise,1950000);assert.equal(r.premiumTotalPaise,780000);assert.equal(r.grossPnlPaise,1170000);assert.equal(r.breakEvenPricePaise,2488000);
});
test("out-of-money options expire with zero intrinsic value",()=>{
 for(const [optionType,underlyingPricePaise] of [["CE",2490000],["PE",2510000]]){
  const r=calculateOptionExpiryPayoff({optionType,strikePricePaise:2500000,premiumPaise:5000,underlyingPricePaise,lots:1,lotSize:65});
  assert.equal(r.intrinsicTotalPaise,0);assert.equal(r.grossPnlPaise,-325000);
 }
});
test("short option payoff is inverse of long option gross payoff",()=>{
 const input={optionType:"PE",strikePricePaise:2500000,premiumPaise:10000,underlyingPricePaise:2480000,lots:1,lotSize:65};
 const buy=calculateOptionExpiryPayoff(input),sell=calculateOptionExpiryPayoff({...input,side:"SELL"});
 assert.equal(sell.grossPnlPaise,-buy.grossPnlPaise);
 assert.equal(sell.maximumBuyerLossPaise,buy.maximumBuyerLossPaise);
});
test("rejects unsupported option side and malformed inputs",()=>{
 assert.throws(()=>calculateOptionExpiryPayoff({optionType:"FUT",strikePricePaise:1,premiumPaise:1,underlyingPricePaise:1,lots:1,lotSize:1}),/only for CE and PE/);
 assert.throws(()=>calculateOptionExpiryPayoff({optionType:"CE",strikePricePaise:1,premiumPaise:1,underlyingPricePaise:1,lots:1,lotSize:1,side:"HOLD"}),/side/);
 assert.throws(()=>calculateOptionExpiryPayoff({optionType:"CE",strikePricePaise:1,premiumPaise:1,underlyingPricePaise:1,lots:0,lotSize:1}));
});
test("rejects unsafe quantity and payoff arithmetic",()=>{
 assert.throws(()=>calculateOptionExpiryPayoff({optionType:"CE",strikePricePaise:1,premiumPaise:1,underlyingPricePaise:1,lots:10000,lotSize:1000000}),/quantity/);
 assert.throws(()=>calculateOptionExpiryPayoff({optionType:"CE",strikePricePaise:1,premiumPaise:Number.MAX_SAFE_INTEGER,underlyingPricePaise:1,lots:2,lotSize:1}),/safe calculation limits/);
});
