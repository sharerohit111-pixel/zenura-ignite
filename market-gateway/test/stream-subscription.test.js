"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {validateStreamInstrumentKeys}=require("../lib/stream-subscription");
const allowed=["NSE_EQ|INE009A01021","NSE_INDEX|Nifty 50","NSE_FO|12345"];
test("accepts official unique instrument keys",()=>{
  assert.deepEqual(validateStreamInstrumentKeys([allowed[0]],allowed,10),[allowed[0]]);
});
test("rejects missing, empty and oversized subscriptions",()=>{
  for(const value of [undefined,null,[],[allowed[0],allowed[1]]]){
    assert.throws(()=>validateStreamInstrumentKeys(value,allowed,1),{status:400});
  }
});
test("rejects duplicate, malformed and unlisted instrument keys",()=>{
  for(const value of [[allowed[0],allowed[0]],[""],["NSE_EQ|"+ "x".repeat(100)],["NSE_EQ|BAD\\nKEY"],["NSE_EQ|NOT-IN-MASTER"]]){
    assert.throws(()=>validateStreamInstrumentKeys(value,allowed,10),{status:400});
  }
});
test("rejects invalid configured subscription limits",()=>{
  for(const limit of [0,-1,1.5,NaN,Infinity]){
    assert.throws(()=>validateStreamInstrumentKeys([allowed[0]],allowed,limit),{status:400});
  }
});
