"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {disconnectUpstoxAccount,isOAuthGenerationCurrent,connectionGeneration}=require("../lib/upstox-disconnect");
function fakeDb(seed={}){
 const docs=new Map(Object.entries(seed));
 return {docs,collection(name){return {doc(id){return {key:name+"/"+id};}}},async runTransaction(fn){
  const tx={async get(ref){const value=docs.get(ref.key);return {exists:docs.has(ref.key),data:()=>value};},set(ref,value,options){docs.set(ref.key,options?.merge?{...docs.get(ref.key),...value}:value);},delete(ref){docs.delete(ref.key);}};
  return fn(tx);
 }};
}
test("disconnect deletes local token, revokes feed lease, and advances generation",async()=>{
 const db=fakeDb({
  "upstoxConnections/u1":{tokenCiphertext:{data:"secret"}},
  "indianMarketStreamLeases/u1":{uid:"u1",leaseId:"l1",expiresAtMs:50000},
  "upstoxConnectionControls/u1":{generation:4,other:"kept"}
 });
 const result=await disconnectUpstoxAccount(db,"u1",1234);
 assert.equal(db.docs.has("upstoxConnections/u1"),false);
 assert.equal(db.docs.get("indianMarketStreamLeases/u1").revoked,true);
 assert.equal(db.docs.get("indianMarketStreamLeases/u1").leaseId,"l1");
 assert.deepEqual(db.docs.get("upstoxConnectionControls/u1"),{generation:5,updatedAtMs:1234,other:"kept"});
 assert.equal(result.generation,5);
});
test("disconnect is idempotent and works without connection or lease",async()=>{
 const db=fakeDb();
 const first=await disconnectUpstoxAccount(db,"u1",10);
 const second=await disconnectUpstoxAccount(db,"u1",20);
 assert.equal(first.generation,1);
 assert.equal(second.generation,2);
 assert.equal(db.docs.has("upstoxConnections/u1"),false);
});
test("disconnect rejects invalid identity and clock",async()=>{
 await assert.rejects(disconnectUpstoxAccount(null,"u1",1),TypeError);
 await assert.rejects(disconnectUpstoxAccount(fakeDb(),"",1),TypeError);
 await assert.rejects(disconnectUpstoxAccount(fakeDb(),"u1",-1),TypeError);
});
test("late OAuth callbacks are rejected after disconnect advances generation",()=>{
 assert.equal(connectionGeneration(null),0);
 assert.equal(isOAuthGenerationCurrent(null,0),true);
 assert.equal(isOAuthGenerationCurrent({generation:2},2),true);
 assert.equal(isOAuthGenerationCurrent({generation:3},2),false);
 assert.equal(isOAuthGenerationCurrent({generation:2},undefined),false);
});
