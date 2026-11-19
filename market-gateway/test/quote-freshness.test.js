"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {quoteAgeMs,isFreshQuote}=require("../lib/quote-freshness");
const NOW=1_800_000_000_000;
test("quote age is calculated from provider trade timestamp",()=>{
  assert.equal(quoteAgeMs(NOW-1200,NOW),1200);
});
test("missing, zero and malformed provider timestamps are unavailable",()=>{
  for(const value of [undefined,null,0,"","invalid",NaN,Infinity])
    assert.equal(quoteAgeMs(value,NOW),null);
});
test("fresh quote accepts exact age boundary",()=>{
  assert.equal(isFreshQuote(NOW-15000,15000,NOW),true);
  assert.equal(isFreshQuote(NOW-15001,15000,NOW),false);
});
test("fresh quote allows only five seconds of future clock skew",()=>{
  assert.equal(isFreshQuote(NOW+5000,15000,NOW),true);
  assert.equal(isFreshQuote(NOW+5001,15000,NOW),false);
});
test("different endpoints can apply different maximum ages",()=>{
  assert.equal(isFreshQuote(NOW-15000,15000,NOW),true);
  assert.equal(isFreshQuote(NOW-15000,60000,NOW),true);
  assert.equal(isFreshQuote(NOW-30000,15000,NOW),false);
  assert.equal(isFreshQuote(NOW-30000,60000,NOW),true);
});
