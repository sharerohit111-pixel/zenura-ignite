"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const { createUpstoxMarketDataAdapter, createAngelOneMarketDataAdapter, istTimestamp }=require("../lib/provider-market-data-adapters");
const NOW=Date.parse("2026-11-24T04:30:00Z");
const args={userId:"user-1",instrumentId:"NSE_EQ|INE002A01018",exchange:"NSE",entitlementReference:"rights-ref"};
const upNative={instrumentKey:"NSE_EQ|INE002A01018",exchange:"NSE"};
const angelNative={exchange:"NSE",exchangeSegment:"NSE",symbolToken:"3045"};
function upQuote(){return {status:"success",data:{"NSE_EQ:RELIANCE":{instrument_token:upNative.instrumentKey,last_price:123.45,timestamp:new Date(NOW-200).toISOString(),last_trade_time:String(NOW-300),depth:{buy:[{price:123.4,quantity:10}],sell:[{price:123.5,quantity:12}]}}}};}
function angelQuote(){return {status:true,data:{fetched:[{exchange:"NSE",symbolToken:"3045",ltp:123.45,exchFeedTime:"24-Nov-2026 10:00:00",exchTradeTime:"24-Nov-2026 09:59:59",depth:{buy:[{price:123.4,quantity:10}],sell:[{price:123.5,quantity:12}]}}]}};}
function clientFor(provider,quote){
 return {
  getHealth:async()=>({healthy:true}),
  getQuote:async()=>quote(),
  getCandles:async()=>provider==="upstox"?{status:"success",data:{candles:[[new Date(NOW-60000).toISOString(),123,125,122,124,100]]}}:{status:true,data:[[new Date(NOW-60000).toISOString(),123,125,122,124,100]]},
  getDepth:async()=>null,
  getInstrumentMaster:async()=>[{instrumentId:args.instrumentId,exchange:"NSE"}],
  normalizeInstrument:row=>row,
  openStream:async()=>({close(){},subscribe(){}}),
 };
}
test("parses Angel One documented IST feed timestamps without local timezone dependence",()=>{
 assert.equal(istTimestamp("24-Nov-2026 10:00:00"),Date.UTC(2026,10,24,4,30,0));
 assert.equal(istTimestamp("bad"),null);
});
test("Upstox adapter normalizes V3 quote, candles, depth and stream handle",async()=>{
 const adapter=createUpstoxMarketDataAdapter({client:clientFor("upstox",upQuote),resolveInstrument:async()=>upNative,now:()=>NOW});
 const q=await adapter.getQuote(args);assert.equal(q.lastPricePaise,12345);assert.equal(q.providerId,"upstox");
 const d=await adapter.getDepth(args);assert.equal(d.bids[0].pricePaise,12340);assert.equal(d.asks[0].quantity,12);
 const c=await adapter.getCandles(args);assert.equal(c.candles[0].closePaise,12400);
 assert.equal((await adapter.getHealth()).healthy,true);
 assert.equal(typeof (await adapter.openStream(args)).stream.close,"function");
});
test("Angel One adapter normalizes documented FULL quote, OHLC candles and depth",async()=>{
 const adapter=createAngelOneMarketDataAdapter({client:clientFor("angelone",angelQuote),resolveInstrument:async()=>angelNative,now:()=>NOW});
 const q=await adapter.getQuote(args);assert.equal(q.lastPricePaise,12345);assert.equal(q.providerId,"angelone");
 const d=await adapter.getDepth(args);assert.equal(d.bids[0].pricePaise,12340);
 const c=await adapter.getCandles(args);assert.equal(c.candles[0].volume,100);
});
test("rejects stale/future quotes and malformed provider envelopes",async()=>{
 const stale=createUpstoxMarketDataAdapter({client:clientFor("upstox",()=>({status:"success",data:{"key":{instrument_token:upNative.instrumentKey,last_price:123.45,timestamp:new Date(NOW-16000).toISOString(),last_trade_time:String(NOW-100)}}})),resolveInstrument:async()=>upNative,now:()=>NOW});
 await assert.rejects(stale.getQuote(args),{code:"stale_market_data"});
 const malformed=createAngelOneMarketDataAdapter({client:clientFor("angelone",()=>({status:false,data:{fetched:[]}})),resolveInstrument:async()=>angelNative,now:()=>NOW});
 await assert.rejects(malformed.getQuote(args),{code:"invalid_market_data"});
});
test("rejects crossed or malformed depth rather than manufacturing a book",async()=>{
 const client=clientFor("upstox",upQuote);
 client.getQuote=async()=>({status:"success",data:{"NSE_EQ:RELIANCE":{instrument_token:upNative.instrumentKey,last_price:123.45,timestamp:new Date(NOW-200).toISOString(),last_trade_time:String(NOW-300),depth:{buy:[{price:124,quantity:10}],sell:[{price:123,quantity:12}]}}}});
 const adapter=createUpstoxMarketDataAdapter({client,resolveInstrument:async()=>upNative,now:()=>NOW});
 await assert.rejects(adapter.getDepth(args),/strictly ordered|crossed/);
});

test("fails closed when a provider cannot resolve a native instrument for candles or streams",async()=>{
 const up=createUpstoxMarketDataAdapter({client:clientFor("upstox",upQuote),resolveInstrument:async()=>null,now:()=>NOW});
 await assert.rejects(up.getCandles(args),/instrument mapping is missing/);
 await assert.rejects(up.openStream(args),/instrument mapping is missing/);
 const angel=createAngelOneMarketDataAdapter({client:clientFor("angelone",angelQuote),resolveInstrument:async()=>({symbolToken:"3045",exchangeSegment:"NSE"}),now:()=>NOW});
 await assert.rejects(angel.getCandles(args),/instrument mapping is missing/);
 await assert.rejects(angel.openStream(args),/instrument mapping is missing/);
});

test("rejects native instrument exchange mismatch before any provider request",async()=>{
 for(const provider of ["upstox","angelone"]){
  let upstreamCalls=0;
  const client=clientFor(provider,provider==="upstox"?upQuote:angelQuote);
  for(const method of ["getQuote","getCandles","openStream"]){
   const original=client[method];
   client[method]=async(...args)=>{upstreamCalls++;return original(...args);};
  }
  const wrong=provider==="upstox"
   ?{instrumentKey:upNative.instrumentKey,exchange:"BSE"}
   :{...angelNative,exchange:"BSE"};
  const adapter=provider==="upstox"
   ?createUpstoxMarketDataAdapter({client,resolveInstrument:async()=>wrong,now:()=>NOW})
   :createAngelOneMarketDataAdapter({client,resolveInstrument:async()=>wrong,now:()=>NOW});
  await assert.rejects(adapter.getQuote(args),{code:"instrument_mismatch"});
  await assert.rejects(adapter.getCandles(args),{code:"instrument_mismatch"});
  await assert.rejects(adapter.openStream(args),{code:"instrument_mismatch"});
  assert.equal(upstreamCalls,0,provider+" must reject before upstream I/O");
 }
});
