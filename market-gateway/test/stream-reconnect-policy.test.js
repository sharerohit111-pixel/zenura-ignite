"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {MAX_RECONNECT_ATTEMPTS,MAX_RECONNECT_DELAY_MS,reconnectDelayMs}=require("../lib/stream-reconnect-policy");
test("uses bounded exponential delay with deterministic jitter",()=>{
 assert.equal(reconnectDelayMs(1,{random:()=>0}),1000);
 assert.equal(reconnectDelayMs(2,{random:()=>0.5}),2125);
 assert.equal(reconnectDelayMs(MAX_RECONNECT_ATTEMPTS,{random:()=>0}),MAX_RECONNECT_DELAY_MS);
});
test("honors provider Retry-After without exceeding its documented cap",()=>{
 assert.equal(reconnectDelayMs(1,{retryAfterSeconds:10,random:()=>0}),10000);
 assert.equal(reconnectDelayMs(1,{retryAfterSeconds:999,random:()=>0}),300000);
});
test("rejects attempts outside the finite retry budget",()=>{
 assert.throws(()=>reconnectDelayMs(0),TypeError);
 assert.throws(()=>reconnectDelayMs(MAX_RECONNECT_ATTEMPTS+1),TypeError);
});
