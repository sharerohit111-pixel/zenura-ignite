"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildDerivativeOrderPreview}=require("../lib/derivative-order-preview");

const now=Date.UTC(2026,10,18,10);
const option=()=>({
 instrument_key:"NSE_FO|NIFTY26NOV25000CE",
 trading_symbol:"NIFTY 26 NOV 25000 CE",
 segment:"NSE_FO",exchange:"NSE",instrument_type:"CE",
 expiry:"2026-11-26",strike_price:25000,lot_size:65,tick_size:0.05
});
const quote=(overrides={})=>({
 instrumentKey:"NSE_FO|NIFTY26NOV25000CE",
 pricePaise:1250,observedAtMs:now-1000,...overrides
});
const margin=(overrides={})=>({
 instrumentKey:"NSE_FO|NIFTY26NOV25000CE",
 requiredMarginPaise:100000,observedAtMs:now-1000,
 source:"verified_broker_snapshot",...overrides
});

test("builds a preview-only long option order from a fresh matching quote",()=>{
 const r=buildDerivativeOrderPreview({
  instrument:option(),lots:1,side:"BUY",quote:quote(),
  availableCashPaise:1000000,now
 });
 assert.equal(r.status,"PREVIEW_ONLY");
 assert.equal(r.contract.quantity,65);
 assert.equal(r.projectedCashDeltaPaise,-81250);
 assert.equal(r.executionEnabled,false);
 assert.equal(r.persisted,false);
 assert.equal(r.simulationOnly,true);
 assert.equal(r.excludesCharges,true);
 assert.equal(typeof r.requestFingerprint,"string");
});

test("requires broker margin snapshot for futures and short options",()=>{
 const future={...option(),instrument_key:"NSE_FO|NIFTY26NOVFUT",
  trading_symbol:"NIFTY FUT",instrument_type:"FUT",strike_price:0};
 assert.throws(()=>buildDerivativeOrderPreview({
  instrument:future,lots:1,side:"BUY",
  quote:quote({instrumentKey:future.instrument_key,pricePaise:2500000}),
  availableCashPaise:1000000,now
 }),/margin snapshot/);
 assert.throws(()=>buildDerivativeOrderPreview({
  instrument:option(),lots:1,side:"SELL",quote:quote(),
  availableCashPaise:1000000,now
 }),/margin snapshot/);
});

test("uses broker margin and rejects insufficient funds",()=>{
 const r=buildDerivativeOrderPreview({
  instrument:option(),lots:1,side:"SELL",quote:quote(),
  marginSnapshot:margin(),availableCashPaise:150000,now
 });
 assert.equal(r.margin.requiredMarginPaise,100000);
 assert.equal(r.margin.canPlacePaperOrder,true);
 assert.throws(()=>buildDerivativeOrderPreview({
  instrument:option(),lots:1,side:"SELL",quote:quote(),
  marginSnapshot:margin(),availableCashPaise:50000,now
 }),/Insufficient/);
});

test("rejects stale, future-dated and mismatched quotes",()=>{
 for(const q of [
  quote({observedAtMs:now-15001}),
  quote({observedAtMs:now+1}),
  quote({instrumentKey:"OTHER"})
 ])assert.throws(()=>buildDerivativeOrderPreview({
  instrument:option(),lots:1,side:"BUY",quote:q,
  availableCashPaise:1000000,now
 }),/fresh market quote/);
});

test("rejects invalid lot sizes and off-tick quote prices",()=>{
 assert.throws(()=>buildDerivativeOrderPreview({
  instrument:option(),lots:0,side:"BUY",quote:quote(),
  availableCashPaise:1000000,now
 }));
 assert.throws(()=>buildDerivativeOrderPreview({
  instrument:option(),lots:1,side:"BUY",quote:quote({pricePaise:1251}),
  availableCashPaise:1000000,now
 }),/tick size/);
});
