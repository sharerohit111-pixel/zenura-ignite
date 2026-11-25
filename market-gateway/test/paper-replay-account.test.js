"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {readReplayAccountState}=require("../lib/paper-replay-account");

function snapshot(exists,data){
  return {exists,data:()=>data};
}

test("returns a validated current account balance",()=>{
  assert.deepEqual(readReplayAccountState(snapshot(true,{cashPaise:12500,realizedPnlPaise:-250})),{
    cashPaise:12500,realizedPnlPaise:-250
  });
});

test("defaults a missing realized P&L to zero for legacy accounts",()=>{
  assert.deepEqual(readReplayAccountState(snapshot(true,{cashPaise:5000})),{
    cashPaise:5000,realizedPnlPaise:0
  });
});

test("rejects a missing account",()=>{
  assert.throws(()=>readReplayAccountState(snapshot(false,null)),{status:409,message:"Paper account is not initialized."});
});

for(const data of [
  null,
  {},
  {cashPaise:-1},
  {cashPaise:1.5},
  {cashPaise:Number.MAX_SAFE_INTEGER+1},
  {cashPaise:100,realizedPnlPaise:1.5},
  {cashPaise:100,realizedPnlPaise:Number.MAX_SAFE_INTEGER+1}
]){
  test("rejects malformed replay balance: "+JSON.stringify(data),()=>{
    assert.throws(()=>readReplayAccountState(snapshot(true,data)),{status:409,message:"Paper account contains invalid balance data."});
  });
}
