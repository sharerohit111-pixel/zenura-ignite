"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createLeaseHeartbeat}=require("../lib/lease-heartbeat");
function fakeTimer(){let callback=null,cleared=false;return {schedule(fn,ms){callback=fn;assert.equal(ms,20000);return 7;},cancel(id){assert.equal(id,7);cleared=true;},async fire(){await callback();},get cleared(){return cleared;}};}
test("heartbeat renews lease and reports successful renewal",async()=>{
 const timer=fakeTimer();let renewed=0,alive=0;
 const hb=createLeaseHeartbeat({renew:async()=>{renewed++;return true;},onRenewed:()=>alive++,schedule:timer.schedule,cancel:timer.cancel});
 await timer.fire();assert.equal(renewed,1);assert.equal(alive,1);hb.stop();assert.equal(timer.cleared,true);
});
test("lost lease stops timer and invokes loss callback",async()=>{
 const timer=fakeTimer();let lost=0;
 createLeaseHeartbeat({renew:async()=>false,onLost:()=>lost++,schedule:timer.schedule,cancel:timer.cancel});
 await timer.fire();assert.equal(lost,1);assert.equal(timer.cleared,true);
});
test("renewal errors stop timer and invoke error callback",async()=>{
 const timer=fakeTimer();let failed=0;
 createLeaseHeartbeat({renew:async()=>{throw Error("offline");},onError:e=>{assert.equal(e.message,"offline");failed++;},schedule:timer.schedule,cancel:timer.cancel});
 await timer.fire();assert.equal(failed,1);assert.equal(timer.cleared,true);
});
test("overlapping renewal ticks are ignored",async()=>{
 const timer=fakeTimer();let resolve,started=0;
 const pending=new Promise(r=>resolve=r);
 const hb=createLeaseHeartbeat({renew:()=>{started++;return pending;},schedule:timer.schedule,cancel:timer.cancel});
 const first=timer.fire();await Promise.resolve();await timer.fire();assert.equal(started,1);resolve(true);await first;hb.stop();
});
test("heartbeat validates its configuration",()=>{
 assert.throws(()=>createLeaseHeartbeat({renew:null}),TypeError);
});
