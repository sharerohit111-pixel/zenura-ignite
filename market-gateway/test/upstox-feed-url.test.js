"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {validateUpstoxFeedUrl}=require("../lib/upstox-feed-url");

test("accepts an official Upstox secure websocket endpoint",()=>{
 const value="wss://xyz.upstox.com/market-data-feeder/v3/feeds?requestId=req&code=single-use";
 assert.equal(validateUpstoxFeedUrl(value),value);
});
test("rejects non-secure or non-Upstox endpoints",()=>{
 for(const value of [
  "ws://xyz.upstox.com/feed",
  "https://xyz.upstox.com/feed",
  "wss://upstox.com.evil.example/feed",
  "wss://evil-upstox.com/feed",
  "wss://evil.example/feed",
  "wss://user:pass@xyz.upstox.com/feed",
  "wss://xyz.upstox.com:8443/feed",
  "wss://xyz.upstox.com/feed#fragment",
  "not a url"
 ])assert.throws(()=>validateUpstoxFeedUrl(value));
});
