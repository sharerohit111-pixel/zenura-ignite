"use strict";
process.env.SUPABASE_URL="https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY="test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY="test-service-role-key";
const test=require("node:test");
const assert=require("node:assert/strict");
const {validateOrderInput,validateRiskPlanInput,isFreshCryptoQuote,getRiskPlanTrigger,makeOrderId,runLimitWorker,createSingleFlightTask,releaseWorkerLeaseSafely,rotateRiskPlanSafely,createRateLimiter,isUuid}=require("../server");
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

test("accepts only fresh, positive Binance Crypto trade quotes",()=>{
 const now=1700000000000;
 assert.equal(isFreshCryptoQuote({priceUsdt:100,tradeTimeMs:now},now),true);
 assert.equal(isFreshCryptoQuote({priceUsdt:100,tradeTimeMs:now-15000},now),true);
 assert.equal(isFreshCryptoQuote({priceUsdt:100,tradeTimeMs:now-15001},now),false);
 assert.equal(isFreshCryptoQuote({priceUsdt:100,tradeTimeMs:now+2001},now),false);
 assert.equal(isFreshCryptoQuote({priceUsdt:0,tradeTimeMs:now},now),false);
 assert.equal(isFreshCryptoQuote({priceUsdt:100,tradeTimeMs:1.5},now),false);
});
test("evaluates SL and Target triggers without firing the opposite threshold",()=>{
 const plan={stop_loss_price:"90",take_profit_price:"120"};
 assert.equal(getRiskPlanTrigger(plan,89),"STOP_LOSS");
 assert.equal(getRiskPlanTrigger(plan,90),"STOP_LOSS");
 assert.equal(getRiskPlanTrigger(plan,119),null);
 assert.equal(getRiskPlanTrigger(plan,120),"TAKE_PROFIT");
 assert.equal(getRiskPlanTrigger({stop_loss_price:null,take_profit_price:"120"},90),null);
 assert.equal(getRiskPlanTrigger({stop_loss_price:"90",take_profit_price:null},120),null);
 assert.equal(getRiskPlanTrigger(plan,0),null);
});
test("bounds combined Crypto LIMIT and SL/Target worker batches to protect the shared lease",async()=>{
 for(const maxOrders of [0,-1,1.5,6,"5",null]) {
  await assert.rejects(runLimitWorker({maxOrders}),/between 1 and 5/);
 }
});

test("risk plan rotation helper succeeds without logging",async()=>{
 const logs=[];
 assert.equal(await rotateRiskPlanSafely(async()=>({error:null}),message=>logs.push(message)),true);
 assert.deepEqual(logs,[]);
});
test("risk plan rotation helper contains returned database errors",async()=>{
 const logs=[];
 assert.equal(await rotateRiskPlanSafely(async()=>({error:new Error("db unavailable")}),message=>logs.push(message)),false);
 assert.equal(logs.length,1);
 assert.match(logs[0],/rotation failed/);
});
test("risk plan rotation helper contains network exceptions",async()=>{
 const logs=[];
 assert.equal(await rotateRiskPlanSafely(async()=>{throw new Error("socket closed");},message=>logs.push(message)),false);
 assert.equal(logs.length,1);
 assert.match(logs[0],/remains eligible/);
});
test("worker lease release helper is quiet on success",async()=>{
 const logs=[];
 await releaseWorkerLeaseSafely(async()=>({data:true,error:null}),message=>logs.push(message));
 assert.deepEqual(logs,[]);
});
test("worker lease release helper logs returned database errors without throwing",async()=>{
 const logs=[];
 await assert.doesNotReject(releaseWorkerLeaseSafely(async()=>({error:new Error("db unavailable")}),message=>logs.push(message)));
 assert.equal(logs.length,1);
 assert.match(logs[0],/lease release failed/);
});
test("worker lease release helper contains network exceptions and preserves caller flow",async()=>{
 const logs=[];
 await assert.doesNotReject(releaseWorkerLeaseSafely(async()=>{throw new Error("socket closed");},message=>logs.push(message)));
 assert.equal(logs.length,1);
 assert.match(logs[0],/bounded lease will expire/);
});

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

test("accepts generated UUID reset request IDs and rejects malformed values",()=>{
 assert.equal(isUuid("123e4567-e89b-42d3-a456-426614174000"),true);
 for(const value of ["","not-a-uuid","123e4567-e89b-42d3-a456-42661417400z","00000000-0000-0000-0000-000000000000"]) assert.equal(isUuid(value),false);
});

test("accepts valid cloud SL/Target plan inputs and canonicalizes symbol",()=>{
 const v=validateRiskPlanInput({symbol:"btcusdt",quantity:"0.001",stop_loss_price:"60000",take_profit_price:"70000",idempotency_key:"123e4567-e89b-42d3-a456-426614174000"});
 assert.deepEqual(v,{symbol:"BTCUSDT",quantity:"0.001",stopLossPrice:"60000",takeProfitPrice:"70000",key:"123e4567-e89b-42d3-a456-426614174000"});
});
test("rejects malformed cloud SL/Target decimals, missing triggers and invalid ranges",()=>{
 const base={symbol:"BTCUSDT",quantity:"0.01",stop_loss_price:"60000",take_profit_price:"70000",idempotency_key:"123e4567-e89b-42d3-a456-426614174000"};
 for(const patch of [{quantity:"0"},{quantity:"1e2"},{quantity:"01"},{quantity:"1.1234567890123"},{stop_loss_price:"60000.123456789"},{stop_loss_price:"0",take_profit_price:null},{stop_loss_price:"80000",take_profit_price:"70000"},{symbol:"NOPEUSDT"}]) {
  assert.throws(()=>validateRiskPlanInput({...base,...patch}));
 }
 assert.throws(()=>validateRiskPlanInput({...base,stop_loss_price:null,take_profit_price:null}));
});

test("single-flight scheduler skips overlapping ticks and resumes after completion",async()=>{
 let calls=0, release;
 const gate=new Promise(resolve=>{release=resolve;});
 const task=createSingleFlightTask(async()=>{calls++;await gate;});
 const first=task();
 await Promise.resolve();
 assert.equal(await task(),false);
 assert.equal(calls,1);
 release();
 assert.equal(await first,true);
 assert.equal(await task(),true);
 assert.equal(calls,2);
});
