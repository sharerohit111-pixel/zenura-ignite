"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {calculateDerivativeMargin}=require("../lib/derivative-margin");
const now=1_800_000_000_000;
const contract=(instrumentType="CE")=>({instrumentKey:"NSE_FO|NIFTY26NOV25000CE",instrumentType,quantity:65,contractValuePaise:650000});
const snapshot=(overrides={})=>({instrumentKey:"NSE_FO|NIFTY26NOV25000CE",requiredMarginPaise:250000,observedAtMs:now-1000,source:"broker_margin_api",...overrides});
test("long option BUY reserves full premium debit",()=>{
 const r=calculateDerivativeMargin({contract:contract("CE"),side:"BUY",pricePaise:10000,availableCashPaise:700000,now});
 assert.equal(r.requiredMarginPaise,650000);assert.equal(r.shortfallPaise,0);assert.equal(r.canPlacePaperOrder,true);assert.equal(r.marginSource,"option_premium_debit");
});
test("long option BUY rejects insufficient virtual cash",()=>{
 const r=calculateDerivativeMargin({contract:contract("PE"),side:"BUY",pricePaise:10000,availableCashPaise:100000,now});
 assert.equal(r.shortfallPaise,550000);assert.equal(r.canPlacePaperOrder,false);
});
test("futures and short options require exact broker margin snapshot",()=>{
 for(const [instrumentType,side] of [["FUT","BUY"],["FUT","SELL"],["CE","SELL"],["PE","SELL"]]){
  const c=contract(instrumentType),s=snapshot({instrumentKey:c.instrumentKey});
  const r=calculateDerivativeMargin({contract:c,side,pricePaise:10000,availableCashPaise:300000,marginSnapshot:s,now});
  assert.equal(r.requiredMarginPaise,250000);assert.equal(r.canPlacePaperOrder,true);
 }
});
test("rejects missing, mismatched and stale broker margin snapshots",()=>{
 const c=contract("FUT");
 assert.throws(()=>calculateDerivativeMargin({contract:c,side:"BUY",pricePaise:10000,availableCashPaise:300000,now}),/snapshot is required/);
 assert.throws(()=>calculateDerivativeMargin({contract:c,side:"BUY",pricePaise:10000,availableCashPaise:300000,marginSnapshot:snapshot({instrumentKey:"OTHER"}),now}),/matching/);
 assert.throws(()=>calculateDerivativeMargin({contract:c,side:"BUY",pricePaise:10000,availableCashPaise:300000,marginSnapshot:snapshot({observedAtMs:now-30001}),now}),/stale/);
 assert.throws(()=>calculateDerivativeMargin({contract:c,side:"BUY",pricePaise:10000,availableCashPaise:300000,marginSnapshot:snapshot({observedAtMs:now+1}),now}),/stale/);
});
test("rejects malformed margin amounts and invalid account values",()=>{
 const c=contract("FUT");
 for(const amount of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>calculateDerivativeMargin({contract:c,side:"SELL",pricePaise:10000,availableCashPaise:300000,marginSnapshot:snapshot({requiredMarginPaise:amount}),now}));
 assert.throws(()=>calculateDerivativeMargin({contract:c,side:"SELL",pricePaise:10000,availableCashPaise:-1,marginSnapshot:snapshot(),now}));
});
test("reports shortfall when broker margin exceeds available cash",()=>{
 const c=contract("FUT");
 const r=calculateDerivativeMargin({contract:c,side:"SELL",pricePaise:10000,availableCashPaise:200000,marginSnapshot:snapshot(),now});
 assert.equal(r.shortfallPaise,50000);assert.equal(r.canPlacePaperOrder,false);
});
