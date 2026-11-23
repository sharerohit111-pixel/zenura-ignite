"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {simulateLongIndexOptionExpiry}=require("../lib/option-expiry-simulation");

const base={
 position:{instrumentKey:"NSE_FO|NIFTY_CE",instrumentType:"CE",expiry:"2026-11-24",netQuantity:65,costBasisPaise:82771},
 contract:{instrumentKey:"NSE_FO|NIFTY_CE",instrumentType:"CE",exchange:"NSE",segment:"NSE_FO",underlyingType:"INDEX",settlementType:"CASH_SETTLED",expiryDate:"2026-11-24",strikePricePaise:2500000},
 settlementPricePaise:2510000,settlementDate:"2026-11-24",
 settlementSource:"https://www.nseindia.com/market-data/settlement-prices",
 settlementSourceSha256:"a".repeat(64),verifiedAtMs:1000,nowMs:2000
};

test("simulates long CE cash-settlement payoff without posting or inventing net charges",()=>{
 const r=simulateLongIndexOptionExpiry(base);
 assert.equal(r.intrinsicValuePerUnitPaise,10000);
 assert.equal(r.grossSettlementPayoutPaise,650000);
 assert.equal(r.grossPnlBeforeSettlementChargesPaise,567229);
 assert.equal(r.settlementChargesPaise,null);
 assert.equal(r.netRealizedPnlPaise,null);
 assert.equal(r.ledgerPostingAllowed,false);
 assert.equal(r.simulationOnly,true);
});

test("simulates long PE and worthless expiry payoff",()=>{
 const pe=simulateLongIndexOptionExpiry({
  ...base,
  position:{...base.position,instrumentType:"PE"},
  contract:{...base.contract,instrumentType:"PE",strikePricePaise:2500000},
  settlementPricePaise:2490000
 });
 assert.equal(pe.grossSettlementPayoutPaise,650000);
 const otm=simulateLongIndexOptionExpiry({...base,settlementPricePaise:2490000});
 assert.equal(otm.grossSettlementPayoutPaise,0);
 assert.equal(otm.grossPnlBeforeSettlementChargesPaise,-82771);
});

test("blocks stock options and unknown/physical settlement types",()=>{
 for(const changes of [
  {contract:{...base.contract,underlyingType:"STOCK",settlementType:"PHYSICAL_SETTLED"}},
  {contract:{...base.contract,settlementType:"UNKNOWN"}},
  {contract:{...base.contract,underlyingType:"STOCK",settlementType:"CASH_SETTLED"}}
 ]){
  assert.throws(()=>simulateLongIndexOptionExpiry({...base,...changes}),{status:422});
 }
});

test("blocks short, mismatched, non-expiry-date or unverified settlement inputs",()=>{
 assert.throws(()=>simulateLongIndexOptionExpiry({...base,position:{...base.position,netQuantity:-65}}),{status:409});
 assert.throws(()=>simulateLongIndexOptionExpiry({...base,settlementDate:"2026-11-23"}),{status:422});
 assert.throws(()=>simulateLongIndexOptionExpiry({...base,settlementSource:"https://example.com/price"}),{status:422});
 assert.throws(()=>simulateLongIndexOptionExpiry({...base,settlementSourceSha256:"bad"}),{status:422});
 assert.throws(()=>simulateLongIndexOptionExpiry({...base,verifiedAtMs:3000}),{status:422});
});
