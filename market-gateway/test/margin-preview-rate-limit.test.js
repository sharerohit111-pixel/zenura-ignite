"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {consumeMarginPreviewSlot,DEFAULT_COOLDOWN_MS}=require("../lib/margin-preview-rate-limit");

function fakeDb(initial=null){
 let state=initial,transactions=0;
 return {
  get state(){return state;},get transactions(){return transactions;},
  collection(name){assert.equal(name,"indianMarginPreviewLimits");return {doc(uid){assert.equal(uid,"user-1");return {uid};}};},
  async runTransaction(callback){transactions++;const writes=[];const tx={
   async get(ref){assert.equal(ref.uid,"user-1");return {exists:state!==null,data:()=>state};},
   set(ref,value){assert.equal(ref.uid,"user-1");writes.push(value);}
  };const result=await callback(tx);if(writes.length)state=writes.at(-1);return result;}
 };
}
test("allows the first request and stores a user-scoped timestamp",async()=>{
 const db=fakeDb();assert.deepEqual(await consumeMarginPreviewSlot(db,"user-1",1000),{allowed:true});
 assert.deepEqual(db.state,{lastRequestAtMs:1000,updatedAtMs:1000});
});
test("rejects requests inside the cooldown with retry guidance",async()=>{
 const db=fakeDb({lastRequestAtMs:1000,updatedAtMs:1000});
 await assert.rejects(consumeMarginPreviewSlot(db,"user-1",5999),error=>error.status===429&&error.retryAfterSeconds===1);
 assert.equal(db.state.lastRequestAtMs,1000);
});
test("does not extend retry guidance when a transaction observes a slightly future timestamp",async()=>{
 const db=fakeDb({lastRequestAtMs:1001,updatedAtMs:1001});
 await assert.rejects(consumeMarginPreviewSlot(db,"user-1",1000),error=>error.status===429&&error.retryAfterSeconds===5);
});
test("allows a request at the exact cooldown boundary",async()=>{
 const db=fakeDb({lastRequestAtMs:1000,updatedAtMs:1000});
 assert.deepEqual(await consumeMarginPreviewSlot(db,"user-1",1000+DEFAULT_COOLDOWN_MS),{allowed:true});
 assert.equal(db.state.lastRequestAtMs,6000);
});
test("rejects malformed stored limiter state without overwriting it",async()=>{
 const db=fakeDb({lastRequestAtMs:"1000"});
 await assert.rejects(consumeMarginPreviewSlot(db,"user-1",10000),{status:503});
 assert.equal(db.state.lastRequestAtMs,"1000");
});
test("validates the limiter dependencies and arguments",async()=>{
 await assert.rejects(consumeMarginPreviewSlot(null,"user-1",1000),TypeError);
 const db=fakeDb();
 await assert.rejects(consumeMarginPreviewSlot(db,"",1000),TypeError);
 await assert.rejects(consumeMarginPreviewSlot(db,"user-1",-1),TypeError);
});
