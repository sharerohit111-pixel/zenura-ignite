"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizeMarketStatus}=require("../lib/market-snapshot");
const now=Date.UTC(2026,10,24,10,0,0);
const base={status:"success",data:{exchange:"NSE",status:"NORMAL_OPEN",last_updated:now-1000}};
test("keeps stale CAS freshness separate from a fresh exchange status",()=>{
  const result=normalizeMarketStatus({...base,data:{...base.data,cas_eligible_status:{status:"CTS_CLOSE",last_updated:now-400000}}},"NSE",{nowMs:now,maxAgeMs:300000});
  assert.equal(result.freshness,"fresh");
  assert.equal(result.casFreshness,"stale");
});
test("rejects malformed and future CAS timestamps",()=>{
  assert.throws(()=>normalizeMarketStatus({...base,data:{...base.data,cas_eligible_status:{status:"UNKNOWN",last_updated:now-1}}},"NSE",{nowMs:now}),/invalid closing-auction status/);
  assert.throws(()=>normalizeMarketStatus({...base,data:{...base.data,cas_eligible_status:{status:"CAS_LM_START",last_updated:now+1}}},"NSE",{nowMs:now}),/closing-auction timestamp is in the future/);
});
test("rejects stale exchange status rather than presenting it as current",()=>{
  assert.throws(()=>normalizeMarketStatus({...base,data:{...base.data,last_updated:now-300001}},"NSE",{nowMs:now}),/invalid exchange market status/);
});
