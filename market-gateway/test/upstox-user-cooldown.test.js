"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const policy=require("../lib/upstox-user-cooldown");

test.beforeEach(()=>policy.clearAllUpstoxUserCooldownsForTests());

test("isolates cooldown state by authenticated user ID",()=>{
  policy.recordUpstoxUserFailure("user-a",{status:429,retryAfterSeconds:20},1000);
  assert.equal(policy.getUpstoxUserCooldown("user-a",1000).retryAfterMs,20000);
  assert.equal(policy.getUpstoxUserCooldown("user-b",1000),null);
});

test("401 applies a bounded reconnect cooldown and expires without deleting the connection",()=>{
  const state=policy.recordUpstoxUserFailure("user-a",{status:401,code:"upstox_reconnect_required"},1000);
  assert.equal(state.kind,"auth");
  assert.equal(state.retryAfterMs,policy.AUTH_COOLDOWN_MS);
  assert.equal(policy.getUpstoxUserCooldown("user-a",1000+policy.AUTH_COOLDOWN_MS),null);
});

test("429 honors provider Retry-After but clamps it to five minutes",()=>{
  assert.equal(policy.recordUpstoxUserFailure("user-a",{status:429,retryAfterSeconds:17},0).retryAfterMs,17000);
  policy.clearUpstoxUserCooldown("user-a");
  assert.equal(policy.recordUpstoxUserFailure("user-a",{status:429,retryAfterSeconds:9999},0).retryAfterMs,policy.MAX_RATE_LIMIT_MS);
});

test("429 without Retry-After uses bounded exponential cooldown",()=>{
  assert.equal(policy.recordUpstoxUserFailure("user-a",{status:429},0).retryAfterMs,5000);
  assert.equal(policy.recordUpstoxUserFailure("user-a",{status:429},1000).retryAfterMs,10000);
});

test("transient provider/network failures use bounded exponential cooldown",()=>{
  assert.equal(policy.recordUpstoxUserFailure("user-a",{status:502},0).retryAfterMs,5000);
  assert.equal(policy.recordUpstoxUserFailure("user-a",{status:502},1000).retryAfterMs,10000);
  for(let i=0;i<8;i++)policy.recordUpstoxUserFailure("user-a",{status:502},2000+i);
  assert.ok(policy.getUpstoxUserCooldown("user-a",2009).retryAfterMs<=policy.TRANSIENT_MAX_MS);
});

test("successful provider response clears only that user's cooldown",()=>{
  policy.recordUpstoxUserFailure("user-a",{status:429,retryAfterSeconds:30},1000);
  policy.recordUpstoxUserFailure("user-b",{status:429,retryAfterSeconds:30},1000);
  assert.equal(policy.clearUpstoxUserCooldown("user-a"),true);
  assert.equal(policy.getUpstoxUserCooldown("user-a",1000),null);
  assert.ok(policy.getUpstoxUserCooldown("user-b",1000));
});

test("invalid identifiers and non-provider client errors do not create cooldown entries",()=>{
  assert.equal(policy.recordUpstoxUserFailure("",{status:401},1000),null);
  assert.equal(policy.recordUpstoxUserFailure("user-a",{status:400},1000),null);
  assert.equal(policy.getUpstoxUserCooldown("user-a",1000),null);
});

test("bounds in-memory user state to prevent unbounded growth",()=>{
  for(let i=0;i<policy.MAX_USERS+1;i++)
    policy.recordUpstoxUserFailure("user-"+i,{status:429,retryAfterSeconds:30},1000);
  assert.equal(policy.getUpstoxUserCooldown("user-0",1000),null);
  assert.ok(policy.getUpstoxUserCooldown("user-1",1000));
});
