"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizeProviderQuote}=require("../lib/provider-quote");
const NOW=1_800_000_000_000;
const KEY="NSE_EQ|INE009A01021";
test("normalizes matching fresh provider quote to integer paise",()=>{
  assert.deepEqual(normalizeProviderQuote({instrument_token:KEY,last_price:123.45,last_trade_time:NOW-1200},KEY,{now:NOW}),{pricePaise:12345,tradeTimeMs:NOW-1200,quoteAgeMs:1200});
});
test("rejects a quote for a different instrument",()=>{
  assert.throws(()=>normalizeProviderQuote({instrument_token:"NSE_EQ|OTHER",last_price:100,last_trade_time:NOW},KEY,{now:NOW}),{status:409});
});
test("rejects missing, malformed and non-positive prices",()=>{
  for(const last_price of [undefined,null,0,-1,"bad",Infinity]){
    assert.throws(()=>normalizeProviderQuote({instrument_token:KEY,last_price,last_trade_time:NOW},KEY,{now:NOW}),{status:409});
  }
});
test("rejects missing, malformed and stale trade timestamps",()=>{
  for(const last_trade_time of [undefined,null,0,"bad",NOW-15001]){
    assert.throws(()=>normalizeProviderQuote({instrument_token:KEY,last_price:100,last_trade_time},KEY,{now:NOW}),{status:409});
  }
});
test("accepts exact freshness boundary and rejects excessive future skew",()=>{
  assert.equal(normalizeProviderQuote({instrument_token:KEY,last_price:1,last_trade_time:NOW-15000},KEY,{now:NOW}).quoteAgeMs,15000);
  assert.throws(()=>normalizeProviderQuote({instrument_token:KEY,last_price:1,last_trade_time:NOW+5001},KEY,{now:NOW}),{status:409});
});
test("rejects prices outside safe integer paise range",()=>{
  assert.throws(()=>normalizeProviderQuote({instrument_token:KEY,last_price:Number.MAX_SAFE_INTEGER,last_trade_time:NOW},KEY,{now:NOW}),{status:409});
});
