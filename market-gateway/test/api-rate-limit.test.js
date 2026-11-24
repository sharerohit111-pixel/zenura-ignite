"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {apiRateLimitBucket,consumeApiRateLimit}=require("../lib/api-rate-limit");

const uid="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("classifies expensive provider routes separately from database reads and writes",()=>{
  assert.equal(apiRateLimitBucket("GET","/candles"),"market_data");
  assert.equal(apiRateLimitBucket("GET","/option-chain"),"market_data");
  assert.equal(apiRateLimitBucket("GET","/watchlist/quotes"),"market_data");
  assert.equal(apiRateLimitBucket("GET","/paper/futures/portfolio"),"market_data");
  assert.equal(apiRateLimitBucket("GET","/paper/orders"),"paper_read");
  assert.equal(apiRateLimitBucket("POST","/paper/orders"),"paper_write");
  assert.equal(apiRateLimitBucket("PUT","/watchlist"),"paper_write");
  assert.equal(apiRateLimitBucket("GET","/upstox/connection"),"account_read");
  assert.equal(apiRateLimitBucket("POST","/upstox/oauth/start"),"oauth");
  assert.equal(apiRateLimitBucket("DELETE","/upstox/connection"),"oauth");
});

test("preserves dedicated margin-preview cooldown and stream lease controls",()=>{
  assert.equal(apiRateLimitBucket("POST","/paper/derivative/margin-preview"),null);
  assert.equal(apiRateLimitBucket("POST","/stream"),null);
});

test("calls the service-only RPC with the authenticated user and fixed bucket",async()=>{
  let call;
  const db={async rpc(name,args){call={name,args};return {data:{allowed:true,remaining:19},error:null};}};
  assert.deepEqual(await consumeApiRateLimit(db,uid,"paper_write"),{
    allowed:true,retryAfterSeconds:0,remaining:19
  });
  assert.deepEqual(call,{
    name:"consume_paper_api_rate_limit",
    args:{p_user_id:uid,p_bucket:"paper_write"}
  });
});

test("returns retry guidance when the atomic database budget is exhausted",async()=>{
  const db={async rpc(){return {data:{allowed:false,retry_after_seconds:17,remaining:0},error:null};}};
  assert.deepEqual(await consumeApiRateLimit(db,uid,"market_data"),{
    allowed:false,retryAfterSeconds:17,remaining:0
  });
});

test("fails closed when the limiter RPC errors, throws or returns malformed data",async()=>{
  for(const db of [
    {async rpc(){return {data:null,error:{message:"database unavailable"}};}},
    {async rpc(){throw new Error("network down");}},
    {async rpc(){return {data:{allowed:"yes"},error:null};}}
  ]){
    await assert.rejects(consumeApiRateLimit(db,uid,"paper_read"),error=>error.status===503);
  }
  await assert.rejects(consumeApiRateLimit(null,uid,"paper_read"),error=>error.status===503);
});

test("rejects untrusted user or bucket inputs before RPC",async()=>{
  let calls=0;const db={async rpc(){calls++;return {data:{allowed:true},error:null};}};
  await assert.rejects(consumeApiRateLimit(db,"","paper_read"),TypeError);
  await assert.rejects(consumeApiRateLimit(db,uid,"unbounded"),TypeError);
  assert.equal(calls,0);
});
