"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {rupeesToPaise,normalizeUpstoxMarginResponse}=require("../lib/upstox-margin");
const key="NSE_FO|NIFTY26NOVFUT";
test("converts rupees to exact paise safely",()=>{
 assert.equal(rupeesToPaise(125.5),12550);
 for(const value of [-1,NaN,Infinity,"10",1.001,Number.MAX_SAFE_INTEGER])assert.equal(rupeesToPaise(value),null);
});
test("normalizes official Upstox margin response",()=>{
 const result=normalizeUpstoxMarginResponse({status:"success",data:{required_margin:12500.5,final_margin:12000,margins:[{instrument_key:key,span:9000,exposure:3500,total_margin:12500.5}]}},key);
 assert.equal(result.requiredMarginPaise,1250050);
 assert.equal(result.finalMarginPaise,1200000);
 assert.deepEqual(result.components,[{spanPaise:900000,exposurePaise:350000,total_marginPaise:1250050}]);
 assert.equal(result.source,"upstox_v2_charges_margin");
});
test("rejects failed, missing, malformed and unsafe margin responses",()=>{
 for(const payload of [null,{}, {status:"error",data:{required_margin:1}},{status:"success",data:{}},{status:"success",data:{required_margin:0}},{status:"success",data:{required_margin:"100"}},{status:"success",data:{required_margin:1.001}},{status:"success",data:{required_margin:100,final_margin:"bad"}}])
  assert.throws(()=>normalizeUpstoxMarginResponse(payload,key),/Upstox/);
});
test("rejects malformed component values rather than silently displaying them",()=>{
 assert.throws(()=>normalizeUpstoxMarginResponse({status:"success",data:{required_margin:100,margins:[{span:"100"}]}},key),/component/);
});
