"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {nextReconnectDelay,shouldRetryFeedStatus,shouldReconnectAfterFeedError}=require("./reconnect-policy");

test("uses exponential reconnect delays",()=>{
  assert.deepEqual([0,1,2,3,4,5].map(nextReconnectDelay),[
    {delayMs:1000,nextAttempt:1},
    {delayMs:2000,nextAttempt:2},
    {delayMs:4000,nextAttempt:3},
    {delayMs:8000,nextAttempt:4},
    {delayMs:16000,nextAttempt:5},
    {delayMs:30000,nextAttempt:5}
  ]);
});
test("caps repeated reconnect delay at thirty seconds",()=>{
  assert.deepEqual(nextReconnectDelay(100),{delayMs:30000,nextAttempt:5});
});
test("invalid attempt values safely start at one second",()=>{
  assert.deepEqual(nextReconnectDelay(-1),{delayMs:1000,nextAttempt:1});
  assert.deepEqual(nextReconnectDelay(1.5),{delayMs:1000,nextAttempt:1});
});
test("does not automatically retry authorization failures",()=>{
  assert.equal(shouldRetryFeedStatus(401),false);
  assert.equal(shouldRetryFeedStatus(403),false);
});
test("retries transient server, rate-limit and network-like statuses",()=>{
  for(const status of [0,408,429,500,502,503,504])assert.equal(shouldRetryFeedStatus(status),true);
});
test("does not retry permanent client errors",()=>{
  for(const status of [400,401,403,404,405,409,422])assert.equal(shouldRetryFeedStatus(status),false);
});
test("rejects invalid status values from retry classification",()=>{
  assert.equal(shouldRetryFeedStatus("500"),false);
  assert.equal(shouldRetryFeedStatus(null),false);
});

test("reconnects after provider error events but not ordinary feed events",()=>{
  assert.equal(shouldReconnectAfterFeedError("error"),true);
  for(const event of ["status","market","message",undefined])assert.equal(shouldReconnectAfterFeedError(event),false);
});

test("adds bounded jitter to reconnect delays to spread client retries",()=>{
  const {jitteredReconnectDelay}=require("./reconnect-policy");
  assert.equal(jitteredReconnectDelay(1000,()=>0),800);
  assert.equal(jitteredReconnectDelay(1000,()=>0.5),1000);
  assert.equal(jitteredReconnectDelay(1000,()=>1),1200);
  assert.equal(jitteredReconnectDelay(30000,()=>1),30000);
  assert.equal(jitteredReconnectDelay(30000,()=>0),24000);
});
test("rejects invalid jitter inputs",()=>{
  const {jitteredReconnectDelay}=require("./reconnect-policy");
  assert.equal(jitteredReconnectDelay(-1),null);
  assert.equal(jitteredReconnectDelay(1000,()=>2),null);
  assert.equal(jitteredReconnectDelay(1000,()=>0.5,2),null);
});
