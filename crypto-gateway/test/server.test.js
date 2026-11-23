"use strict";
process.env.SUPABASE_URL="https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY="test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY="test-service-role-key";
const test=require("node:test");
const assert=require("node:assert/strict");
const {validateOrderInput,makeOrderId,runLimitWorker,createRateLimiter}=require("../server");
test("accepts supported market order and canonicalizes symbol",()=>{
 const v=validateOrderInput({symbol:"btcusdt",side:"buy",quantity:"0.001",idempotency_key:"123e4567-e89b-42d3-a456-426614174000"});
 assert.equal(v.symbol,"BTCUSDT"); assert.equal(v.side,"BUY"); assert.equal(v.quantityRaw,"0.001");
});
test("rejects unsupported symbol",()=>{
 assert.throws(()=>validateOrderInput({symbol:"FAKEUSDT",side:"BUY",quantity:"1",idempotency_key:"123e4567-e89b-42d3-a456-426614174000"}),/supported Crypto/);
});
test("rejects malformed precision and zero quantity",()=>{
 for(const quantity of ["0","-1","1.1234567890123","01","1e3"]) assert.throws(()=>validateOrderInput({symbol:"BTCUSDT",side:"BUY",quantity,idempotency_key:"123e4567-e89b-42d3-a456-426614174000"}));
});
test("requires valid LIMIT price",()=>{
 assert.throws(()=>validateOrderInput({symbol:"BTCUSDT",side:"BUY",quantity:"1",limit_price:"0",idempotency_key:"123e4567-e89b-42d3-a456-426614174000"},true));
});
test("derives deterministic user-scoped UUID order IDs",()=>{
 const a=makeOrderId("11111111-1111-4111-8111-111111111111","123e4567-e89b-42d3-a456-426614174000");
 const b=makeOrderId("11111111-1111-4111-8111-111111111111","123e4567-e89b-42d3-a456-426614174000");
 const c=makeOrderId("22222222-2222-4222-8222-222222222222","123e4567-e89b-42d3-a456-426614174000");
 assert.equal(a,b); assert.notEqual(a,c); assert.match(a,/^[0-9a-f-]{36}$/);
});

test("rejects Crypto LIMIT worker batches that could exceed the lease budget",async()=>{ await assert.rejects(runLimitWorker({maxOrders:11}),/between 1 and 10/); });

test("rate limiter bounds order requests and returns a retry window",()=>{
 let now=1000, status=0, payload, headers={};
 const limiter=createRateLimiter({windowMs:60000,max:2,maxKeys:2,now:()=>now});
 const request={socket:{remoteAddress:"127.0.0.1"}};
 const response={
  set(name,value){headers[name]=value;return this;},
  status(value){status=value;return this;},
  json(value){payload=value;return this;}
 };
 let nextCalls=0;
 limiter(request,response,()=>nextCalls++);
 limiter(request,response,()=>nextCalls++);
 limiter(request,response,()=>nextCalls++);
 assert.equal(nextCalls,2);
 assert.equal(status,429);
 assert.equal(headers["Retry-After"],"60");
 assert.deepEqual(payload,{error:"Too many Crypto order requests. Retry later."});
 now+=60000; status=0; payload=undefined;
 limiter(request,response,()=>nextCalls++);
 assert.equal(nextCalls,3);
});
test("rate limiter does not trust forwarded client address headers",()=>{
 let now=1000, status=0, nextCalls=0;
 const limiter=createRateLimiter({windowMs:60000,max:1,maxKeys:2,now:()=>now});
 const response={set(){return this;},status(v){status=v;return this;},json(){return this;}};
 const req=(forwarded)=>({socket:{remoteAddress:"proxy-peer"},headers:{"x-forwarded-for":forwarded}});
 limiter(req("198.51.100.1"),response,()=>nextCalls++);
 limiter(req("203.0.113.2"),response,()=>nextCalls++);
 assert.equal(nextCalls,1);
 assert.equal(status,429);
});
