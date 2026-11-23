"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {
  extractUpstoxRestExecutableQuote,
  evaluateUpstoxRestDerivativeLimit
}=require("../lib/upstox-rest-executable-quote");

const NOW=1_800_000_000_000;
const KEY="NSE_FO|NIFTY26NOVFUT";
function response({timestamp=new Date(NOW-1000).toISOString(),bid=201.25,bidQty=10,ask=201.30,askQty=12}={}){
  return {
    status:"success",
    data:{
      "NSE_FO:NIFTY26NOVFUT":{
        instrument_token:KEY,symbol:"NIFTY FUT",
        timestamp,
        last_price:99999,
        depth:{
          buy:[{price:bid,quantity:bidQty,orders:2}],
          sell:[{price:ask,quantity:askQty,orders:3}]
        }
      }
    }
  };
}

test("extracts REST V3 timestamp and top-of-book prices as integer paise",()=>{
  assert.deepEqual(extractUpstoxRestExecutableQuote(response(),KEY,{nowMs:NOW}),{
    instrumentKey:KEY,timestampMs:NOW-1000,ageMs:1000,
    bidPricePaise:20125,bidQuantity:10,askPricePaise:20130,askQuantity:12
  });
});

test("BUY uses best ask and SELL uses best bid, capped by displayed quantity",()=>{
  const buy=evaluateUpstoxRestDerivativeLimit(response(),KEY,{
    side:"BUY",limitPricePaise:20130,remainingQuantity:25,nowMs:NOW
  });
  const sell=evaluateUpstoxRestDerivativeLimit(response(),KEY,{
    side:"SELL",limitPricePaise:20125,remainingQuantity:5,nowMs:NOW
  });
  assert.equal(buy.eligible,true);
  assert.equal(buy.pricePaise,20130);
  assert.equal(buy.fillQuantity,12);
  assert.equal(sell.eligible,true);
  assert.equal(sell.pricePaise,20125);
  assert.equal(sell.fillQuantity,5);
  assert.equal(evaluateUpstoxRestDerivativeLimit(response(),KEY,{
    side:"BUY",limitPricePaise:20125,remainingQuantity:25,nowMs:NOW
  }).reason,"LIMIT_NOT_REACHED");
});

test("rejects missing depth and never falls back to last_price",()=>{
  const payload=response();
  delete payload.data["NSE_FO:NIFTY26NOVFUT"].depth;
  assert.throws(()=>extractUpstoxRestExecutableQuote(payload,KEY,{nowMs:NOW}),{status:409});
  const empty=response({askQty:0});
  assert.equal(evaluateUpstoxRestDerivativeLimit(empty,KEY,{
    side:"BUY",limitPricePaise:99999,remainingQuantity:25,nowMs:NOW
  }).reason,"INCOMPLETE_DEPTH_BOOK");
});

test("rejects wrong instrument identity and malformed response",()=>{
  const wrong=response();
  wrong.data["NSE_FO:NIFTY26NOVFUT"].instrument_token="NSE_FO|OTHER";
  assert.throws(()=>extractUpstoxRestExecutableQuote(wrong,KEY,{nowMs:NOW}),{status:409});
  assert.throws(()=>extractUpstoxRestExecutableQuote({status:"error",data:{}},KEY,{nowMs:NOW}),{status:409});
});

test("rejects missing, future, stale and timezone-ambiguous snapshot timestamps",()=>{
  for(const timestamp of [null,"bad",new Date(NOW+1).toISOString(),
    new Date(NOW-15001).toISOString(),"2026-11-23T10:00:00"]){
    assert.throws(()=>extractUpstoxRestExecutableQuote(response({timestamp}),KEY,{nowMs:NOW}),{status:409});
  }
  assert.equal(extractUpstoxRestExecutableQuote(
    response({timestamp:new Date(NOW-15000).toISOString()}),KEY,{nowMs:NOW}
  ).ageMs,15000);
});

test("rejects crossed books and malformed prices or quantities",()=>{
  assert.throws(()=>extractUpstoxRestExecutableQuote(response({bid:201.35,ask:201.30}),KEY,{nowMs:NOW}),{
    status:409,message:"Upstox V3 returned a crossed bid/ask book; executable quote rejected."
  });
  for(const args of [{ask:0},{ask:201.301},{ask:"201.30"},{askQty:-1},{askQty:1.5},{askQty:2147483648}]){
    const quote=extractUpstoxRestExecutableQuote(response(args),KEY,{nowMs:NOW});
    assert.equal(quote.askPricePaise===null||quote.askQuantity===0,true);
  }
});

test("rejects invalid order-side evaluation inputs",()=>{
  assert.throws(()=>evaluateUpstoxRestDerivativeLimit(response(),KEY,{
    side:"HOLD",limitPricePaise:20130,remainingQuantity:1,nowMs:NOW
  }),TypeError);
  assert.throws(()=>evaluateUpstoxRestDerivativeLimit(response(),KEY,{
    side:"BUY",limitPricePaise:20130,remainingQuantity:0,nowMs:NOW
  }),TypeError);
});
