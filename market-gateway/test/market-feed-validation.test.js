"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {isFreshMarketFeedQuote,filterFreshMarketFeeds}=require("../lib/market-feed-validation");
const NOW=1_800_000_000_000;
const KEY="NSE_EQ|INE001A01036";
const quote=(overrides={})=>({ltp:250.25,ltt:String(NOW-1000),...overrides});
test("accepts positive quote with fresh millisecond trade timestamp",()=>assert.equal(isFreshMarketFeedQuote(quote(),{now:NOW}),true));
test("rejects zero, negative, malformed and unsafe prices",()=>{
 for(const ltp of [0,-1,"bad",Number.MAX_VALUE])assert.equal(isFreshMarketFeedQuote(quote({ltp}),{now:NOW}),false);
});
test("rejects missing, malformed, stale and excessive future timestamps",()=>{
 for(const ltt of [undefined,"bad",0,String(NOW-15001),String(NOW+5001)])assert.equal(isFreshMarketFeedQuote(quote({ltt}),{now:NOW}),false);
});
test("accepts exact stale-age and future-skew boundaries",()=>{
 assert.equal(isFreshMarketFeedQuote(quote({ltt:String(NOW-15000)}),{now:NOW}),true);
 assert.equal(isFreshMarketFeedQuote(quote({ltt:String(NOW+5000)}),{now:NOW}),true);
});
test("filters unknown instruments and stale quotes without changing valid feed data",()=>{
 const valid={ltpc:quote()};
 const payload={type:"live_feed",feeds:{[KEY]:valid,"NSE_EQ|UNSUBSCRIBED":{ltpc:quote() },"NSE_EQ|STALE":{ltpc:quote({ltt:String(NOW-16000)})}}};
 const result=filterFreshMarketFeeds(payload,[KEY],{now:NOW});
 assert.deepEqual(result,{type:"live_feed",feeds:{[KEY]:valid}});
});
test("returns null when there are no valid subscribed instrument quotes",()=>{
 assert.equal(filterFreshMarketFeeds({feeds:{"NSE_EQ|STALE":{ltpc:quote({ltt:String(NOW-20000)})}}},[KEY],{now:NOW}),null);
});
test("validates full-feed and index-feed LTPC variants",()=>{
 for(const feed of [{fullFeed:{marketFF:{ltpc:quote()}}},{fullFeed:{indexFF:{ltpc:quote()}}}]){
  assert.equal(filterFreshMarketFeeds({feeds:{[KEY]:feed}},[KEY],{now:NOW})!==null,true);
 }
});
