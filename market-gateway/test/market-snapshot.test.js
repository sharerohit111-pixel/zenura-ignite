"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizeMarketDepthQuote,normalizeMarketStatus}=require("../lib/market-snapshot");
const now=Date.UTC(2026,10,24,10,0,0);
const instrument={instrument_key:"NSE_EQ|INE000A01001",tick_size:0.05};
function quote(overrides={}){return {status:"success",data:{"NSE_EQ:TEST":{
 instrument_token:instrument.instrument_key,timestamp:new Date(now-1000).toISOString(),last_price:100.1,volume:1200,
 ohlc:{open:99,high:101,low:98,close:100.1},
 depth:{buy:[{price:100,quantity:20,orders:2},{price:99.95,quantity:10,orders:1}],
 sell:[{price:100.1,quantity:15,orders:2},{price:100.15,quantity:9,orders:1}]},...overrides}}};}
test("normalizes fresh bid/ask depth, OHLC and provider timestamp",()=>{
 const result=normalizeMarketDepthQuote(quote(),instrument,{nowMs:now});
 assert.equal(result.status,"fresh");assert.equal(result.ageMs,1000);
 assert.equal(result.bids[0].pricePaise,10000);assert.equal(result.asks[0].quantity,15);
 assert.equal(result.ohlc.high,10100);assert.equal(result.lastPricePaise,10010);
});
test("marks stale quote without relabelling it fresh",()=>{
 assert.equal(normalizeMarketDepthQuote(quote({timestamp:new Date(now-16000).toISOString()}),instrument,{nowMs:now}).status,"stale");
});
test("rejects wrong instrument, future timestamp, crossed book and off-tick depth",()=>{
 assert.throws(()=>normalizeMarketDepthQuote({status:"success",data:{}},instrument,{nowMs:now}),/requested instrument/);
 assert.throws(()=>normalizeMarketDepthQuote(quote({timestamp:new Date(now+1).toISOString()}),instrument,{nowMs:now}),/future/);
 assert.throws(()=>normalizeMarketDepthQuote(quote({depth:{buy:[{price:101,quantity:1,orders:1}],sell:[{price:100,quantity:1,orders:1}]}}),instrument,{nowMs:now}),/crossed/);
 assert.throws(()=>normalizeMarketDepthQuote(quote({depth:{buy:[{price:100.01,quantity:1,orders:1}],sell:[]}}),instrument,{nowMs:now}),/invalid price/);
});
test("normalizes NSE/BSE market status and rejects stale/future or mismatched status",()=>{
 const payload={status:"success",data:{exchange:"NSE",status:"NORMAL_OPEN",last_updated:now-5000,cas_eligible_status:{status:"CTS_CLOSE",last_updated:now-4000}}};
 const result=normalizeMarketStatus(payload,"NSE",{nowMs:now});
 assert.equal(result.freshness,"fresh");assert.equal(result.casStatus,"CTS_CLOSE");
 assert.throws(()=>normalizeMarketStatus(payload,"BSE",{nowMs:now}),/invalid exchange/);
 assert.throws(()=>normalizeMarketStatus({...payload,data:{...payload.data,last_updated:now+1}},"NSE",{nowMs:now}),/future/);
 assert.equal(normalizeMarketStatus({...payload,data:{...payload.data,last_updated:now-300001}},"NSE",{nowMs:now}).freshness,"stale");
 assert.throws(()=>normalizeMarketStatus({...payload,data:{...payload.data,status:"UNKNOWN"}},"NSE",{nowMs:now}),/invalid exchange/);
 assert.throws(()=>normalizeMarketStatus({...payload,data:{...payload.data,cas_eligible_status:{status:"CTS_CLOSE",last_updated:now+1}}},"NSE",{nowMs:now}),/closing-auction timestamp is in the future/);
});
test("rejects unsorted depth and more than five levels",()=>{
 const unsorted=quote({depth:{buy:[{price:99.95,quantity:1,orders:1},{price:100,quantity:1,orders:1}],sell:[]}});
 assert.throws(()=>normalizeMarketDepthQuote(unsorted,instrument,{nowMs:now}),/not ordered/);
 const tooMany=Array.from({length:6},(_,i)=>({price:100-i*.05,quantity:1,orders:1}));
 assert.throws(()=>normalizeMarketDepthQuote(quote({depth:{buy:tooMany,sell:[]}}),instrument,{nowMs:now}),/at most five/);
});
