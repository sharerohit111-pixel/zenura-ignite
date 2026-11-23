"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {
 validateOptionLimitOrder,evaluateOptionLimitQuote,allocateOptionLimitReservation
}=require("../lib/option-limit-policy");

const instrument={
 instrument_key:"NSE_FO|NIFTY26DEC25000CE",trading_symbol:"NIFTY 26 DEC 25000 CE",
 exchange:"NSE",segment:"NSE_FO",instrument_type:"CE",expiry:"2026-12-31",
 strike_price:25000,lot_size:65,tick_size:5
};

test("NSE long CE BUY LIMIT validates contract, tick and reserves premium plus estimated charges",()=>{
 const result=validateOptionLimitOrder({
  instrument,side:"BUY",lots:1,limitPricePaise:1250,
  availableCashPaise:1000000,nowMs:Date.parse("2026-11-23T10:00:00+05:30")
 });
 assert.equal(result.quantity,65);
 assert.equal(result.reservedCloseQuantity,0);
 assert.ok(result.reservedCashPaise>result.contractValuePaise);
 assert.equal(result.estimatedCharges.totalDebitPaise,result.reservedCashPaise);
 assert.equal(result.simulationOnly,true);
});

test("NSE long PE BUY LIMIT follows the same long-only reservation contract",()=>{
 const result=validateOptionLimitOrder({
  instrument:{...instrument,instrument_type:"PE",instrument_key:"NSE_FO|NIFTY26DEC25000PE"},
  side:"BUY",lots:2,limitPricePaise:1250,availableCashPaise:1000000,
  nowMs:Date.parse("2026-11-23T10:00:00+05:30")
 });
 assert.equal(result.quantity,130);
 assert.equal(result.reservedCloseQuantity,0);
});

test("SELL LIMIT reserves only unreserved quantity from an existing long option",()=>{
 const result=validateOptionLimitOrder({
  instrument,side:"SELL",lots:1,limitPricePaise:1250,
  availableLongQuantity:130,reservedCloseQuantity:65,
  nowMs:Date.parse("2026-11-23T10:00:00+05:30")
 });
 assert.equal(result.reservedCashPaise,0);
 assert.equal(result.reservedCloseQuantity,65);
});

test("SELL LIMIT cannot open a short option or overlap another close reservation",()=>{
 assert.throws(()=>validateOptionLimitOrder({
  instrument,side:"SELL",lots:1,limitPricePaise:1250,
  availableLongQuantity:65,reservedCloseQuantity:65,
  nowMs:Date.parse("2026-11-23T10:00:00+05:30")
 }),{status:409});
 assert.throws(()=>validateOptionLimitOrder({
  instrument,side:"SELL",lots:1,limitPricePaise:1250,
  availableLongQuantity:0,reservedCloseQuantity:0,
  nowMs:Date.parse("2026-11-23T10:00:00+05:30")
 }),{status:409});
});

test("BSE, futures and unsupported instrument types remain disabled",()=>{
 for(const bad of [
  {...instrument,exchange:"BSE",segment:"BSE_FO"},
  {...instrument,segment:"NSE_EQ"},
  {...instrument,instrument_type:"FUT"}
 ]){
  assert.throws(()=>validateOptionLimitOrder({
   instrument:bad,side:"BUY",lots:1,limitPricePaise:1250,
   availableCashPaise:1000000,nowMs:Date.parse("2026-11-23T10:00:00+05:30")
  }),{status:422});
 }
});

test("BUY LIMIT requires enough unreserved cash including the estimated order charges",()=>{
 assert.throws(()=>validateOptionLimitOrder({
  instrument,side:"BUY",lots:1,limitPricePaise:1250,
  availableCashPaise:1,nowMs:Date.parse("2026-11-23T10:00:00+05:30")
 }),{status:409});
});

test("limit prices must be positive and tick-aligned; lots must be whole",()=>{
 const nowMs=Date.parse("2026-11-23T10:00:00+05:30");
 assert.throws(()=>validateOptionLimitOrder({
  instrument,side:"BUY",lots:1,limitPricePaise:1251,
  availableCashPaise:1000000,nowMs
 }),/tick size/);
 assert.throws(()=>validateOptionLimitOrder({
  instrument,side:"BUY",lots:0,limitPricePaise:1250,
  availableCashPaise:1000000,nowMs
 }),/Lots/);
});

test("quote evaluation uses executable ask for BUY and bid for SELL with no LTP fallback",()=>{
 const payload={
  status:"success",data:{"NSE_FO|NIFTY26DEC25000CE":{
   instrument_token:instrument.instrument_key,
   timestamp:"2026-11-23T04:30:00.000Z",
   depth:{buy:[{price:12.4,quantity:130}],sell:[{price:12.5,quantity:65}]}
  }}
 };
 const buy=evaluateOptionLimitQuote(payload,instrument,{
  side:"BUY",limitPricePaise:1250,remainingQuantity:130,tickSizePaise:5
 },{nowMs:Date.parse("2026-11-23T04:30:01.000Z")});
 assert.equal(buy.eligible,true);
 assert.equal(buy.pricePaise,1250);
 assert.equal(buy.fillQuantity,65);
 const sell=evaluateOptionLimitQuote(payload,instrument,{
  side:"SELL",limitPricePaise:1240,remainingQuantity:65,tickSizePaise:5
 },{nowMs:Date.parse("2026-11-23T04:30:01.000Z")});
 assert.equal(sell.eligible,true);
 assert.equal(sell.pricePaise,1240);
});

test("quote evaluation fails closed on missing instrument, stale quote and off-tick executable price",()=>{
 const payload={
  status:"success",data:{"NSE_FO|NIFTY26DEC25000CE":{
   instrument_token:instrument.instrument_key,
   timestamp:"2026-11-23T04:30:00.000Z",
   depth:{buy:[{price:12.41,quantity:130}],sell:[{price:12.5,quantity:65}]}
  }}
 };
 const result=evaluateOptionLimitQuote(payload,instrument,{
  side:"SELL",limitPricePaise:1240,remainingQuantity:65,tickSizePaise:5
 },{nowMs:Date.parse("2026-11-23T04:30:01.000Z")});
 assert.equal(result.eligible,false);
 assert.equal(result.reason,"OFF_TICK_EXECUTABLE_PRICE");
 assert.throws(()=>evaluateOptionLimitQuote(payload,instrument,{
  side:"BUY",limitPricePaise:1250,remainingQuantity:65,tickSizePaise:5
 },{nowMs:Date.parse("2026-11-23T04:31:00.000Z")}));
});

test("cash reservation allocation conserves every paise and assigns the exact remainder on final fill",()=>{
 const a=allocateOptionLimitReservation({remainingReservationPaise:10001,remainingQuantity:3,fillQuantity:1});
 const b=allocateOptionLimitReservation({remainingReservationPaise:a.remainingReservationPaise,remainingQuantity:2,fillQuantity:1});
 const c=allocateOptionLimitReservation({remainingReservationPaise:b.remainingReservationPaise,remainingQuantity:1,fillQuantity:1});
 assert.equal(a.allocatedReservationPaise+b.allocatedReservationPaise+c.allocatedReservationPaise,10001);
 assert.equal(c.remainingReservationPaise,0);
 assert.equal(c.remainingQuantity,0);
});

test("reservation allocator rejects invalid and over-sized fills",()=>{
 assert.throws(()=>allocateOptionLimitReservation({remainingReservationPaise:-1,remainingQuantity:2,fillQuantity:1}),TypeError);
 assert.throws(()=>allocateOptionLimitReservation({remainingReservationPaise:100,remainingQuantity:2,fillQuantity:3}),RangeError);
});
