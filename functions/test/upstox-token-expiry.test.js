"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {nextUpstoxTokenExpiry}=require("../lib/upstox-token-expiry");
const ist=(y,m,d,h,min)=>Date.UTC(y,m-1,d,h,min)-330*60*1000;
test("token created before 03:30 IST expires at 03:30 the same day",()=>{
 assert.equal(nextUpstoxTokenExpiry(ist(2026,11,18,2,30)),ist(2026,11,18,3,30));
});
test("token created after 03:30 IST expires at 03:30 the next day",()=>{
 assert.equal(nextUpstoxTokenExpiry(ist(2026,11,18,9,0)),ist(2026,11,19,3,30));
});
test("token created exactly at cutoff expires at the next day's cutoff",()=>{
 assert.equal(nextUpstoxTokenExpiry(ist(2026,11,18,3,30)),ist(2026,11,19,3,30));
});
test("expiry calculation is independent of server timezone and handles month boundary",()=>{
 assert.equal(nextUpstoxTokenExpiry(ist(2026,12,31,22,0)),ist(2027,1,1,3,30));
});
test("rejects invalid issue timestamps",()=>{
 assert.throws(()=>nextUpstoxTokenExpiry(-1),TypeError);
 assert.throws(()=>nextUpstoxTokenExpiry(1.5),TypeError);
});
