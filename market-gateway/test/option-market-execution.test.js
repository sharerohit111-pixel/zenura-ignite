"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {resolveNseOptionMarketExecution}=require("../lib/option-market-execution");

const KEY="NSE_FO|NIFTY26NOV25000CE";
const NOW=Date.parse("2026-11-23T05:00:00.000Z");
const instrument={
  instrument_key:KEY,trading_symbol:"NIFTY26NOV25000CE",
  exchange:"NSE",segment:"NSE_FO",instrument_type:"CE",
  lot_size:65,tick_size:5
};
function payload({timestamp=new Date(NOW-1000).toISOString(),bid=12.35,ask=12.4,bidQty=130,askQty=130}={}){
  return {status:"success",data:{[KEY]:{
    instrument_token:KEY,timestamp,
    depth:{
      buy:[{price:bid,quantity:bidQty}],
      sell:[{price:ask,quantity:askQty}]
    },
    last_price:99.99,last_trade_time:NOW-1000
  }}};
}

test("MARKET BUY executes at fresh best ask, never LTP",()=>{
  const result=resolveNseOptionMarketExecution(payload(),instrument,{
    side:"BUY",quantity:65,nowMs:NOW
  });
  assert.equal(result.pricePaise,1240);
  assert.equal(result.quoteTimestampMs,NOW-1000);
  assert.equal(result.quoteAgeMs,1000);
  assert.equal(result.availableQuantity,130);
});

test("MARKET SELL-to-close executes at fresh best bid",()=>{
  const result=resolveNseOptionMarketExecution(payload(),instrument,{
    side:"SELL",quantity:65,nowMs:NOW
  });
  assert.equal(result.pricePaise,1235);
});

test("rejects BSE Options and non-option/non-NSE contracts",()=>{
  assert.throws(()=>resolveNseOptionMarketExecution(payload(),{...instrument,exchange:"BSE",segment:"BSE_FO"},{
    side:"BUY",quantity:65,nowMs:NOW
  }),/NSE long CE\/PE/);
  assert.throws(()=>resolveNseOptionMarketExecution(payload(),{...instrument,instrument_type:"FUT"},{
    side:"BUY",quantity:65,nowMs:NOW
  }),/NSE long CE\/PE/);
});

test("rejects stale, future-dated, missing and crossed executable books",()=>{
  assert.throws(()=>resolveNseOptionMarketExecution(payload({timestamp:new Date(NOW-15001).toISOString()}),instrument,{
    side:"BUY",quantity:65,nowMs:NOW
  }),/stale/);
  assert.throws(()=>resolveNseOptionMarketExecution(payload({timestamp:new Date(NOW+1).toISOString()}),instrument,{
    side:"BUY",quantity:65,nowMs:NOW
  }),/future-dated/);
  assert.throws(()=>resolveNseOptionMarketExecution({status:"success",data:{}},instrument,{
    side:"BUY",quantity:65,nowMs:NOW
  }),/missing/);
  assert.throws(()=>resolveNseOptionMarketExecution(payload({bid:12.5,ask:12.4}),instrument,{
    side:"BUY",quantity:65,nowMs:NOW
  }),/crossed/);
});

test("rejects insufficient depth, off-tick prices and non-lot quantities",()=>{
  assert.throws(()=>resolveNseOptionMarketExecution(payload({askQty:64}),instrument,{
    side:"BUY",quantity:65,nowMs:NOW
  }),/Insufficient/);
  assert.throws(()=>resolveNseOptionMarketExecution(payload({bid:12.36}),instrument,{
    side:"SELL",quantity:65,nowMs:NOW
  }),/off tick/);
  assert.throws(()=>resolveNseOptionMarketExecution(payload(),instrument,{
    side:"BUY",quantity:64,nowMs:NOW
  }),/whole-lot/);
});
