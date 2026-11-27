"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {fetchProviderWithTimeout}=require("../lib/provider-fetch");

test("applies a bounded timeout signal to provider requests",async()=>{
  const signal={timeout:true};
  let received;
  const response={ok:true};
  const result=await fetchProviderWithTimeout(async(url,options)=>{received={url,options};return response;},"https://provider.example/data",{headers:{Accept:"application/json"}},12000,ms=>{assert.equal(ms,12000);return signal;});
  assert.equal(result,response);
  assert.equal(received.url,"https://provider.example/data");
  assert.equal(received.options.signal,signal);
  assert.deepEqual(received.options.headers,{Accept:"application/json"});
});

test("maps upstream network failures to a safe 502 provider error",async()=>{
  await assert.rejects(
    fetchProviderWithTimeout(async()=>{throw new TypeError("socket detail");},"https://provider.example/data",{},15000,()=>({})),
    error=>error.status===502&&error.message==="Upstream provider request failed."&&error.cause instanceof TypeError
  );
});

test("preserves timeout and abort errors for 504 handling",async()=>{
  for(const name of ["TimeoutError","AbortError"]){
    const failure=Object.assign(new Error("timeout"),{name});
    await assert.rejects(fetchProviderWithTimeout(async()=>{throw failure;},"https://provider.example/data",{},15000,()=>({})),error=>error===failure);
  }
});
