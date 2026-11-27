"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {MAX_RECONNECT_ATTEMPTS,reconnectDelayMs}=require("../lib/stream-reconnect-policy");
const {reserveUserStream,releaseUserStream}=require("../lib/stream-registry");
const {createStreamLifecycle}=require("../lib/stream-lifecycle");
test("reconnect lifecycle releases only its own reservation before a replacement stream",()=>{
 const registry=new Map(),uid="disposable-user";
 const first=reserveUserStream(registry,uid);
 assert.ok(first);
 let cleanupCount=0;
 const lifecycle=createStreamLifecycle(()=>{
  cleanupCount++;
  assert.equal(releaseUserStream(registry,uid,first),true);
 });
 assert.equal(reconnectDelayMs(1,{random:()=>0}),1000);
 assert.equal(lifecycle.stop(),true);
 assert.equal(cleanupCount,1);
 const second=reserveUserStream(registry,uid);
 assert.ok(second);
 assert.notEqual(second,first);
 assert.equal(releaseUserStream(registry,uid,first),false);
 assert.equal(registry.get(uid),second);
});
test("reconnect attempts stop at the configured finite budget",()=>{
 const delays=[];
 for(let attempt=1;attempt<=MAX_RECONNECT_ATTEMPTS;attempt++)
  delays.push(reconnectDelayMs(attempt,{random:()=>0}));
 assert.equal(delays.length,5);
 assert.throws(()=>reconnectDelayMs(MAX_RECONNECT_ATTEMPTS+1,{random:()=>0}),TypeError);
});
test("repeated close signals cannot release a replacement connection",()=>{
 const registry=new Map(),uid="disposable-user";
 const first=reserveUserStream(registry,uid);
 let lifecycle;
 lifecycle=createStreamLifecycle(()=>releaseUserStream(registry,uid,first));
 assert.equal(lifecycle.stop(),true);
 const replacement=reserveUserStream(registry,uid);
 assert.ok(replacement);
 assert.equal(lifecycle.stop(),false);
 assert.equal(registry.get(uid),replacement);
});
