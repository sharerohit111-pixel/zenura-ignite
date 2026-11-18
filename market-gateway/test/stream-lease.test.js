"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {acquireStreamLease,renewStreamLease,releaseStreamLease}=require("../lib/stream-lease");
function fakeDb(){
 const docs=new Map();
 return {docs,collection(name){return {doc(id){return {key:name+"/"+id};}}},async runTransaction(fn){
  const tx={async get(ref){const value=docs.get(ref.key);return {exists:Boolean(value),data:()=>value};},set(ref,value){docs.set(ref.key,value);},delete(ref){docs.delete(ref.key);}};
  return fn(tx);
 }};
}
test("only one lease can be acquired for a user at a time",async()=>{
 const db=fakeDb();
 assert.equal(await acquireStreamLease(db,"u1","lease-a",{now:1000}),true);
 assert.equal(await acquireStreamLease(db,"u1","lease-b",{now:2000}),false);
 assert.equal(await acquireStreamLease(db,"u2","lease-c",{now:2000}),true);
});
test("expired leases can be reclaimed",async()=>{
 const db=fakeDb();
 assert.equal(await acquireStreamLease(db,"u1","old",{now:1000,leaseMs:1000}),true);
 assert.equal(await acquireStreamLease(db,"u1","new",{now:2000,leaseMs:1000}),true);
 assert.equal(db.docs.get("indianMarketStreamLeases/u1").leaseId,"new");
});
test("only current lease owner can renew or release",async()=>{
 const db=fakeDb();
 await acquireStreamLease(db,"u1","a",{now:1000,leaseMs:1000});
 assert.equal(await renewStreamLease(db,"u1","wrong",{now:1100}),false);
 assert.equal(await releaseStreamLease(db,"u1","wrong"),false);
 assert.equal(await renewStreamLease(db,"u1","a",{now:1100,leaseMs:2000}),true);
 assert.equal(db.docs.get("indianMarketStreamLeases/u1").expiresAtMs,3100);
 assert.equal(await releaseStreamLease(db,"u1","a"),true);
 assert.equal(db.docs.has("indianMarketStreamLeases/u1"),false);
});
test("expired lease cannot be renewed",async()=>{
 const db=fakeDb();
 await acquireStreamLease(db,"u1","a",{now:1000,leaseMs:1000});
 assert.equal(await renewStreamLease(db,"u1","a",{now:2000}),false);
});

test("lease acquisition and renewal reject unsafe timing bounds",async()=>{
 const db=fakeDb();
 assert.equal(await acquireStreamLease(db,"u1","bad-now",{now:1.5}),false);
 assert.equal(await acquireStreamLease(db,"u1","bad-duration",{now:1000,leaseMs:999}),false);
 assert.equal(await acquireStreamLease(db,"u1","overflow",{now:Number.MAX_SAFE_INTEGER-500,leaseMs:1000}),false);
 await acquireStreamLease(db,"u1","valid",{now:1000,leaseMs:2000});
 assert.equal(await renewStreamLease(db,"u1","valid",{now:1100,leaseMs:0}),false);
 assert.equal(await renewStreamLease(db,"u1","valid",{now:1100,leaseMs:1000.5}),false);
 assert.equal(await renewStreamLease(db,"u1","valid",{now:Number.MAX_SAFE_INTEGER-500,leaseMs:1000}),false);
 assert.equal(db.docs.get("indianMarketStreamLeases/u1").expiresAtMs,3000);
});
test("lease helpers reject invalid collection names",async()=>{
 const db=fakeDb();
 assert.equal(await acquireStreamLease(db,"u1","a",{now:1000,collection:""}),false);
 assert.equal(await renewStreamLease(db,"u1","a",{now:1000,collection:""}),false);
 assert.equal(await releaseStreamLease(db,"u1","a",{collection:""}),false);
});
