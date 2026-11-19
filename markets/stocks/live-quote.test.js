"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {extractFreshQuote}=require("./live-quote");
const now=1_800_000_000_000;
test("extracts fresh LTPC quote as integer paise",()=>{
 const q=extractFreshQuote({ltpc:{ltp:123.45,ltt:now-1000}},{now});
 assert.deepEqual(q,{ltp:123.45,pricePaise:12345,tradeTimeMs:now-1000,quoteAgeMs:1000});
});
test("supports full market and index feed shapes",()=>{
 assert.equal(extractFreshQuote({fullFeed:{marketFF:{ltpc:{ltp:10,ltt:now}}}},{now}).pricePaise,1000);
 assert.equal(extractFreshQuote({fullFeed:{indexFF:{ltpc:{ltp:20,ltt:now}}}},{now}).pricePaise,2000);
});
test("rejects stale, future, invalid and unsafe quotes",()=>{
 for(const feed of [
  {ltpc:{ltp:10,ltt:now-15001}},
  {ltpc:{ltp:10,ltt:now+5001}},
  {ltpc:{ltp:0,ltt:now}},
  {ltpc:{ltp:-1,ltt:now}},
  {ltpc:{ltp:"bad",ltt:now}},
  {ltpc:{ltp:Number.MAX_SAFE_INTEGER,ltt:now}},
  {ltpc:{ltp:10,ltt:"bad"}}
 ])assert.equal(extractFreshQuote(feed,{now}),null);
});
test("accepts quote at freshness boundaries",()=>{
 assert.ok(extractFreshQuote({ltpc:{ltp:1,ltt:now-15000}},{now}));
 assert.ok(extractFreshQuote({ltpc:{ltp:1,ltt:now+5000}},{now}));
});
test("rejects malformed options and missing feeds",()=>{
 assert.equal(extractFreshQuote(null,{now}),null);
 assert.equal(extractFreshQuote({ltpc:{ltp:1,ltt:now}},{now,maxAgeMs:-1}),null);
});
