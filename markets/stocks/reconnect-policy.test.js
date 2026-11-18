"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {nextReconnectDelay}=require("./reconnect-policy");

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
