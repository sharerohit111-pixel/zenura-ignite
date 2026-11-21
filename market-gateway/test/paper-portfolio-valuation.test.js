"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildPortfolioValuation,readStoredPaperPositions}=require("../lib/paper-portfolio-valuation");
const now=1_800_000_000_000;
const pos=[["NSE_EQ|ABC",{quantity:10,averagePricePaise:10000}],["NSE_EQ|XYZ",{quantity:2,averagePricePaise:5000}]];
test("values fresh holdings in paise and computes equity and unrealized P&L",()=>{
 const result=buildPortfolioValuation({positions:pos,quotes:[{instrument_token:"NSE_EQ|ABC",last_price:110,last_trade_time:now-1000,symbol:"ABC"},{instrument_token:"NSE_EQ|XYZ",last_price:45,last_trade_time:now-2000,symbol:"XYZ"}],cashPaise:500000,realizedPnlPaise:1200,now});
 assert.equal(result.marketValuePaise,110000+9000);
 assert.equal(result.unrealizedPnlPaise,10000-1000);
 assert.equal(result.equityPaise,619000);
 assert.equal(result.realizedPnlPaise,1200);
 assert.equal(result.valuationStatus,"fresh");
 assert.equal(result.simulationOnly,true);
});
test("excludes stale holdings from totals and marks partial valuation",()=>{
 const result=buildPortfolioValuation({positions:pos,quotes:[{instrument_token:"NSE_EQ|ABC",last_price:110,last_trade_time:now-1000},{instrument_token:"NSE_EQ|XYZ",last_price:45,last_trade_time:now-61000}],cashPaise:500000,now});
 assert.equal(result.marketValuePaise,110000);
 assert.equal(result.equityPaise,610000);
 assert.equal(result.stalePositions,1);
 assert.equal(result.positions[1].valuationStatus,"stale_or_unavailable");
});
test("rejects unsafe aggregate values and invalid account data",()=>{
 assert.throws(()=>buildPortfolioValuation({positions:[["NSE_EQ|ABC",{quantity:1000000,averagePricePaise:1,costBasisPaise:1000000}]],quotes:[{instrument_token:"NSE_EQ|ABC",last_price:100000000,last_trade_time:now}],cashPaise:0,now}),/safe calculation limits/);
 assert.throws(()=>buildPortfolioValuation({positions:pos,quotes:[],cashPaise:-1,now}),/Invalid portfolio valuation input/);
});
test("rejects invalid positions and more than fifty holdings",()=>{
 assert.throws(()=>buildPortfolioValuation({positions:[["x",{quantity:0,averagePricePaise:1}]],quotes:[],cashPaise:0,now}),/invalid position/);
 assert.throws(()=>buildPortfolioValuation({positions:Array.from({length:51},(_,i)=>["k"+i,{quantity:1,averagePricePaise:1}]),quotes:[],cashPaise:0,now}),/more than 50/);
});
test("supports empty portfolios without a provider quote",()=>{
 const result=buildPortfolioValuation({positions:[],quotes:[],cashPaise:100000,now});
 assert.equal(result.valuationStatus,"no_open_positions");
 assert.equal(result.equityPaise,100000);
});

test("rejects missing, null, array, or malformed cash-equity positions storage",()=>{
 for(const account of [null,{positions:null},{positions:[]},{positions:"invalid"}])
  assert.throws(()=>readStoredPaperPositions(account),{status:409});
});
test("reads valid legacy and current cash-equity position maps",()=>{
 assert.deepEqual(readStoredPaperPositions({positions:undefined}),[]);
 assert.deepEqual(readStoredPaperPositions({positions:{"NSE_EQ|ABC":{quantity:1,averagePricePaise:100}}}),[["NSE_EQ|ABC",{quantity:1,averagePricePaise:100}]]);
});

test("values equity unrealized P&L from exact paise cost basis",()=>{
 const exact=[["NSE_EQ|ABC",{quantity:2,averagePricePaise:101,costBasisPaise:201}]];
 const result=buildPortfolioValuation({positions:exact,quotes:[{instrument_token:"NSE_EQ|ABC",last_price:1.10,last_trade_time:now}],cashPaise:0,now});
 assert.equal(result.positions[0].costBasisPaise,201);
 assert.equal(result.marketValuePaise,220);
 assert.equal(result.unrealizedPnlPaise,19);
});
test("rejects inconsistent exact cash-equity cost basis",()=>{
 const invalid=[["NSE_EQ|ABC",{quantity:2,averagePricePaise:101,costBasisPaise:199}]];
 assert.throws(()=>buildPortfolioValuation({positions:invalid,quotes:[],cashPaise:0,now}),/invalid cost basis/);
});

test("reads Delivery and Intraday holdings from isolated account maps",()=>{
 const account={positions:{"NSE_EQ|DEL":{quantity:2,averagePricePaise:100}},intradayPositions:{"NSE_EQ|INTRA":{quantity:3,averagePricePaise:200}}};
 assert.deepEqual(readStoredPaperPositions(account),[[ "NSE_EQ|DEL",account.positions["NSE_EQ|DEL"] ]]);
 assert.deepEqual(readStoredPaperPositions(account,"DELIVERY"),[[ "NSE_EQ|DEL",account.positions["NSE_EQ|DEL"] ]]);
 assert.deepEqual(readStoredPaperPositions(account,"INTRADAY"),[[ "NSE_EQ|INTRA",account.intradayPositions["NSE_EQ|INTRA"] ]]);
 assert.throws(()=>readStoredPaperPositions(account,"intraday"),{status:400});
 assert.throws(()=>readStoredPaperPositions({...account,intradayPositions:[]},"INTRADAY"),{status:409});
});
