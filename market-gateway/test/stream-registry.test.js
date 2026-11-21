"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {reserveUserStream,releaseUserStream}=require("../lib/stream-registry");
test("reserves at most one active stream per account",()=>{
 const registry=new Map(),first=reserveUserStream(registry,"user-1");
 assert.ok(first);
 assert.equal(reserveUserStream(registry,"user-1"),null);
 assert.ok(reserveUserStream(registry,"user-2"));
});
test("releasing the current reservation permits reconnect",()=>{
 const registry=new Map(),first=reserveUserStream(registry,"user-1");
 assert.equal(releaseUserStream(registry,"user-1",first),true);
 assert.ok(reserveUserStream(registry,"user-1"));
});
test("stale reservation cannot release a newer connection",()=>{
 const registry=new Map(),first=reserveUserStream(registry,"user-1");
 releaseUserStream(registry,"user-1",first);
 const second=reserveUserStream(registry,"user-1");
 assert.equal(releaseUserStream(registry,"user-1",first),false);
 assert.equal(registry.get("user-1"),second);
});
test("invalid account identifiers cannot reserve streams",()=>{
 const registry=new Map();
 for(const uid of ["",null,undefined,12])assert.equal(reserveUserStream(registry,uid),null);
 assert.equal(reserveUserStream([], "user-1"),null);
});
