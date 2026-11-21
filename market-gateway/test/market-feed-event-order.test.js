"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createMarketFeedEventOrderFilter}=require("../lib/market-feed-event-order");
const KEY_A="NSE_EQ|AAA",KEY_B="NSE_EQ|BBB";
const event=(feeds)=>({type:"live_feed",feeds});
const feed=(ltt,ltp=100)=>({ltpc:{ltt:String(ltt),ltp}});
test("accepts the first fresh timestamp for each subscribed instrument",()=>{
 const filter=createMarketFeedEventOrderFilter();
 const input=event({[KEY_A]:feed(1000),[KEY_B]:feed(2000)});
 assert.deepEqual(filter(input),input);
});
test("drops duplicate timestamps without suppressing a newer event",()=>{
 const filter=createMarketFeedEventOrderFilter();
 assert.ok(filter(event({[KEY_A]:feed(1000)})));
 assert.equal(filter(event({[KEY_A]:feed(1000,101)})),null);
 assert.deepEqual(filter(event({[KEY_A]:feed(1001,102)})),event({[KEY_A]:feed(1001,102)}));
});
test("drops out-of-order timestamps independently per instrument",()=>{
 const filter=createMarketFeedEventOrderFilter();
 filter(event({[KEY_A]:feed(5000),[KEY_B]:feed(7000)}));
 assert.deepEqual(filter(event({[KEY_A]:feed(4999),[KEY_B]:feed(7001)})),event({[KEY_B]:feed(7001)}));
});
test("supports LTPC fields in full and index feed variants",()=>{
 const filter=createMarketFeedEventOrderFilter();
 assert.ok(filter(event({[KEY_A]:{fullFeed:{marketFF:{ltpc:feed(10).ltpc}}}})));
 assert.ok(filter(event({[KEY_B]:{fullFeed:{indexFF:{ltpc:feed(20).ltpc}}}})));
});
test("ignores malformed timestamps and empty payloads",()=>{
 const filter=createMarketFeedEventOrderFilter();
 assert.equal(filter(event({[KEY_A]:feed("bad"),[KEY_B]:feed(0)})),null);
 assert.equal(filter(null),null);
 assert.equal(filter(event({})),null);
});
test("a new stream filter starts with an empty timestamp history",()=>{
 const first=createMarketFeedEventOrderFilter();
 first(event({[KEY_A]:feed(9000)}));
 const second=createMarketFeedEventOrderFilter();
 assert.ok(second(event({[KEY_A]:feed(8000)})));
});
