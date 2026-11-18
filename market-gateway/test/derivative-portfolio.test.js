"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {calculateDerivativePortfolio}=require("../lib/derivative-portfolio");
const now=1_800_000_000_000;
const pos=(overrides={})=>({instrumentKey:"NSE_FO|NIFTY26NOV25000CE",instrumentType:"CE",netQuantity:25,averagePricePaise:5000,...overrides});
const quote=(overrides={})=>({instrumentKey:"NSE_FO|NIFTY26NOV25000CE",pricePaise:7000,observedAtMs:now-1000,...overrides});
const margin=(overrides={})=>({instrumentKey:"NSE_FO|NIFTY26NOV25000CE",requiredMarginPaise:150000,observedAtMs:now-1000,source:"broker_margin_api",...overrides});
test("values long option market value and unrealized P&L",()=>{
 const r=calculateDerivativePortfolio({positions:[pos()],quotes:[quote()],now});
 assert.equal(r.marketValuePaise,175000);assert.equal(r.positions[0].marketValuePaise,175000);assert.equal(r.unrealizedPnlPaise,50000);assert.equal(r.reservedMarginPaise,0);
});
test("values short option signed P&L and requires margin snapshot",()=>{
 const p=pos({netQuantity:-25});
 assert.throws(()=>calculateDerivativePortfolio({positions:[p],quotes:[quote()],now}),/margin snapshot/);
 const r=calculateDerivativePortfolio({positions:[p],quotes:[quote()],marginSnapshots:[margin()],now});
 assert.equal(r.marketValuePaise,-175000);assert.equal(r.unrealizedPnlPaise,-50000);assert.equal(r.reservedMarginPaise,150000);
});
test("futures exclude notional market value but mark P&L and margin",()=>{
 const p=pos({instrumentType:"FUT",netQuantity:50,averagePricePaise:10000});
 const r=calculateDerivativePortfolio({positions:[p],quotes:[quote({pricePaise:12000})],marginSnapshots:[margin()],now});
 assert.equal(r.marketValuePaise,0);assert.equal(r.positions[0].marketValuePaise,0);assert.equal(r.unrealizedPnlPaise,100000);assert.equal(r.reservedMarginPaise,150000);
});
test("long option unrealized P&L uses exact entry cost basis including fees",()=>{
 const p=pos({instrumentType:"CE",netQuantity:65,averagePricePaise:1287,costBasisPaise:83646});
 const r=calculateDerivativePortfolio({positions:[p],quotes:[quote({pricePaise:1500})],now});
 assert.equal(r.unrealizedPnlPaise,13854);
 assert.equal(r.positions[0].costBasisPaise,83646);
});
test("rejects stale, future-dated and missing quotes",()=>{
 const p=pos();
 assert.throws(()=>calculateDerivativePortfolio({positions:[p],quotes:[],now}),/fresh quote/);
 assert.throws(()=>calculateDerivativePortfolio({positions:[p],quotes:[quote({observedAtMs:now-15001})],now}),/stale/);
 assert.throws(()=>calculateDerivativePortfolio({positions:[p],quotes:[quote({observedAtMs:now+1})],now}),/stale/);
});
test("rejects stale or missing margin for short options and futures",()=>{
 for(const p of [pos({netQuantity:-25}),pos({instrumentType:"FUT"})]){
  assert.throws(()=>calculateDerivativePortfolio({positions:[p],quotes:[quote({instrumentKey:p.instrumentKey})],now}),/margin snapshot/);
  assert.throws(()=>calculateDerivativePortfolio({positions:[p],quotes:[quote({instrumentKey:p.instrumentKey})],marginSnapshots:[margin({observedAtMs:now-30001})],now}),/margin snapshot/);
 }
});
test("rejects duplicate positions, duplicate quotes and unsafe totals",()=>{
 const p=pos();
 assert.throws(()=>calculateDerivativePortfolio({positions:[p,p],quotes:[quote()],now}),/malformed or duplicated/);
 assert.throws(()=>calculateDerivativePortfolio({positions:[p],quotes:[quote(),quote()],now}),/duplicate/);
 assert.throws(()=>calculateDerivativePortfolio({positions:[p],quotes:[quote({pricePaise:Number.MAX_SAFE_INTEGER})],now}),/safe calculation/);
});

test("rejects derivative positions with inconsistent or unsafe cost basis",()=>{
 const p=pos();
 for(const malformed of [
  {...p,costBasisPaise:1},
  {...p,costBasisPaise:Number.MAX_SAFE_INTEGER+1},
  {...p,netQuantity:1_000_000,averagePricePaise:Number.MAX_SAFE_INTEGER}
 ]){
  assert.throws(()=>calculateDerivativePortfolio({positions:[malformed],quotes:[quote()],now}),/cost basis|safe calculation/);
 }
});
test("accepts valid short legacy position without explicit cost basis",()=>{
 const p=pos({netQuantity:-25});
 const r=calculateDerivativePortfolio({positions:[p],quotes:[quote()],marginSnapshots:[margin()],now});
 assert.equal(r.positions[0].costBasisPaise,125000);
 assert.equal(r.unrealizedPnlPaise,-50000);
});
