"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createSingleFlight}=require("../lib/single-flight");

test("coalesces concurrent refreshes into one task",async()=>{
  let calls=0,release;
  const task=createSingleFlight(()=>{calls++;return new Promise(resolve=>{release=resolve;});});
  const first=task(),second=task(),third=task();
  await Promise.resolve();
  assert.equal(calls,1);
  release("fresh");
  assert.deepEqual(await Promise.all([first,second,third]),["fresh","fresh","fresh"]);
});

test("allows a new refresh after success",async()=>{
  let calls=0;
  const task=createSingleFlight(async()=>++calls);
  assert.equal(await task(),1);
  assert.equal(await task(),2);
});

test("allows retry after a failed refresh",async()=>{
  let calls=0;
  const task=createSingleFlight(async()=>{calls++;if(calls===1)throw new Error("temporary");return "ok";});
  await assert.rejects(task(),/temporary/);
  assert.equal(await task(),"ok");
});
