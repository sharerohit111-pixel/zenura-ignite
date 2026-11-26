"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createStreamLifecycle}=require("../lib/stream-lifecycle");
test("stream cleanup runs exactly once across repeated close signals",()=>{
 let cleanups=0;
 const lifecycle=createStreamLifecycle(()=>{cleanups++;});
 assert.equal(lifecycle.closed,false);
 assert.equal(lifecycle.stop(),true);
 assert.equal(lifecycle.closed,true);
 assert.equal(lifecycle.stop(),false);
 assert.equal(lifecycle.stop(),false);
 assert.equal(cleanups,1);
});
test("lifecycle marks itself closed before running cleanup",()=>{
 let lifecycle;
 let observedClosed=false;
 lifecycle=createStreamLifecycle(()=>{observedClosed=lifecycle.closed;assert.equal(lifecycle.stop(),false);});
 assert.equal(lifecycle.stop(),true);
 assert.equal(observedClosed,true);
});
test("lifecycle rejects a missing cleanup callback",()=>{
 assert.throws(()=>createStreamLifecycle(),TypeError);
});
