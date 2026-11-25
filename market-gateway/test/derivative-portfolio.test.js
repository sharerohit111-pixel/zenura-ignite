"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {calculateDerivativePortfolio}=require("../lib/derivative-portfolio");
const {buildLongOptionPortfolioPositions,validateFuturesPortfolioContracts,expiryCutoffMs}=require("../lib/derivative-portfolio-input");
const now=1_800_000_000_000;
const pos=(overrides={})=>({instrumentKey:"NSE_FO|NIFTY26NOV25000CE",instrumentType:"CE",expiry:"2027-12-30",netQuantity:25,averagePricePaise:5000,...overrides});
const quote=(overrides={})=>({instrumentKey:"NSE_FO|NIFTY26NOV25000CE",pricePaise:7000,observedAtMs:now-1000,...overrides});
const margin=(overrides={})=>({instrumentKey:"NSE_FO|NIFTY26NOV25000CE",requiredMarginPaise:150000,observedAtMs:now-1000,source:"upstox_v2_charges_margin",...overrides});
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


test("rejects expired Futures and Options positions before reading a current-looking mark",()=>{
 for(const p of [pos({expiry:"2026-12-31"}),pos({instrumentType:"FUT",expiry:"2026-12-31"})]){
  assert.throws(()=>calculateDerivativePortfolio({positions:[p],quotes:[quote({instrumentKey:p.instrumentKey})],marginSnapshots:[margin({instrumentKey:p.instrumentKey})],now}),/Expired derivative positions/);
 }
});

test("requires explicit valid expiry and rejects quote contract metadata mismatch",()=>{
 const missing=pos();delete missing.expiry;
 assert.throws(()=>calculateDerivativePortfolio({positions:[missing],quotes:[quote()],now}),/requires a valid contract expiry/);
 assert.throws(()=>calculateDerivativePortfolio({positions:[pos()],quotes:[quote({expiry:"2027-12-31"})],now}),/identity does not match/);
 assert.throws(()=>calculateDerivativePortfolio({positions:[pos()],quotes:[quote({optionType:"PE"})],now}),/identity does not match/);
});


test("rejects margin snapshots without the exact normalized Upstox provenance",()=>{
 const p=pos({instrumentType:"FUT"});
 for(const source of [undefined,"broker_margin_api","user_input","MOCK","upstox_v3_margin"]){
  const m=margin({instrumentKey:p.instrumentKey,source});
  assert.throws(()=>calculateDerivativePortfolio({positions:[p],quotes:[quote({instrumentKey:p.instrumentKey})],marginSnapshots:[m],now}),/unverified derivative margin snapshot provenance/);
 }
});


const optionMaster=(overrides={})=>({instrument_key:"NSE_FO|NIFTY26DEC25000CE",instrument_type:"CE",segment:"NSE_FO",exchange:"NSE",expiry:"2027-12-31",strike_price:25000,lot_size:25,...overrides});
const optionRow=(overrides={})=>({instrument_key:"NSE_FO|NIFTY26DEC25000CE",instrument_type:"CE",segment:"NSE_FO",exchange:"NSE",expiry:"2027-12-31",lot_size:25,net_quantity:25,average_price_paise:5000,cost_basis_paise:125000,...overrides});

test("binds long-option portfolio positions to the exact official contract, expiry, strike and lot size",()=>{
 const [p]=buildLongOptionPortfolioPositions([optionRow()],[optionMaster()]);
 assert.equal(p.expiry,"2027-12-31");
 assert.equal(p.optionType,"CE");
 assert.equal(p.strikePaise,2500000);
 assert.equal(p.instrumentKey,optionMaster().instrument_key);
});

test("rejects long-option positions whose official master identity, expiry, exchange, type or lot size differs",()=>{
 const cases=[
  {row:optionRow({instrument_key:"NSE_FO|OTHER"})},
  {master:optionMaster({instrument_type:"PE"})},
  {master:optionMaster({expiry:"2027-01-28"})},
  {master:optionMaster({exchange:"BSE",segment:"BSE_FO"})},
  {master:optionMaster({lot_size:50})},
  {master:optionMaster({strike_price:"invalid"})},
  {row:optionRow({expiry:null})},
  {row:optionRow({net_quantity:-25})}
 ];
 for(const item of cases)assert.throws(()=>buildLongOptionPortfolioPositions([item.row||optionRow()],[item.master||optionMaster()]),/Stored (?:long-option|option)|Official option strike/);
});

test("rejects duplicate option positions and duplicate official master keys",()=>{
 assert.throws(()=>buildLongOptionPortfolioPositions([optionRow(),optionRow()],[optionMaster()]),/malformed or duplicated/);
 assert.throws(()=>buildLongOptionPortfolioPositions([optionRow()],[optionMaster(),optionMaster()]),/duplicate derivative contract identity/);
});

const futuresMaster=(overrides={})=>({instrument_key:"NSE_FO|NIFTY26DECFUT",instrument_type:"FUT",segment:"NSE_FO",exchange:"NSE",expiry:"2026-12-31",lot_size:25,...overrides});
const futuresRow=(overrides={})=>({instrument_key:"NSE_FO|NIFTY26DECFUT",segment:"NSE_FO",exchange:"NSE",expiry:"2026-12-31",lot_size:25,net_quantity:25,average_price_paise:2500000,...overrides});

test("binds futures portfolio positions to the official master and calculates the existing expiry cutoff",()=>{
 const rows=[futuresRow()],map=validateFuturesPortfolioContracts(rows,[futuresMaster()]);
 assert.equal(map.get(rows[0].instrument_key).expiry,"2026-12-31");
 assert.equal(map.get(rows[0].instrument_key).expiryCutoffMs,Date.parse("2026-12-31T10:00:00.000Z"));
 assert.equal(expiryCutoffMs("2026-12-31"),Date.parse("2026-12-31T10:00:00.000Z"));
});

test("rejects futures portfolio contract identity, expiry, lot-size and malformed-position mismatches",()=>{
 const cases=[
  {row:futuresRow({instrument_key:"NSE_FO|OTHER"})},
  {master:futuresMaster({instrument_type:"CE"})},
  {master:futuresMaster({expiry:"2027-01-28"})},
  {master:futuresMaster({exchange:"BSE",segment:"BSE_FO"})},
  {master:futuresMaster({lot_size:50})},
  {row:futuresRow({net_quantity:0})}
 ];
 for(const item of cases)assert.throws(()=>validateFuturesPortfolioContracts([item.row||futuresRow()],[item.master||futuresMaster()]),/Stored Futures position/);
});


test("officially bound option positions and enriched quote metadata pass portfolio valuation",()=>{
 const [p]=buildLongOptionPortfolioPositions([optionRow()],[optionMaster()]);
 const enrichedQuote=quote({instrumentKey:p.instrumentKey,expiry:p.expiry,instrumentType:p.instrumentType,optionType:p.optionType,strikePaise:p.strikePaise});
 const result=calculateDerivativePortfolio({positions:[p],quotes:[enrichedQuote],now});
 assert.equal(result.valuationStatus,"fresh");
 assert.equal(result.marketValuePaise,175000);
 assert.equal(result.unrealizedPnlPaise,50000);
 assert.equal(result.positions[0].marketPricePaise,7000);
});
