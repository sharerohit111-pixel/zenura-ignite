"use strict";
process.env.SUPABASE_URL="https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY="test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY="test-service-role-key";
const test=require("node:test");
const assert=require("node:assert/strict");
const {validateOrderInput,makeOrderId,runLimitWorker}=require("../server");
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
