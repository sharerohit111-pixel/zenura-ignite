"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {MarketDataProviderRouter}=require("../lib/market-data-provider-router");
const {ProviderHealthRegistry}=require("../lib/provider-health-registry");
const {createUpstoxMarketDataAdapter}=require("../lib/provider-market-data-adapters");
const NOW=Date.parse("2026-11-24T04:30:00Z");
const approvedRightsGate=()=>({rightsReference:"verified-provider-rights",regulatoryReference:"verified-product-clearance"});
const args={userId:"user-1",instrumentId:"NSE_EQ|INE002A01018",exchange:"NSE",entitlementReference:"entitlement-upstox"};
function client(){
 const native={instrumentKey:args.instrumentId};
 const entry={instrument_token:native.instrumentKey,last_price:123.45,timestamp:new Date(NOW-200).toISOString(),last_trade_time:String(NOW-300),depth:{buy:[{price:123.4,quantity:10}],sell:[{price:123.5,quantity:12}]}};
 return {
  getHealth:async()=>({healthy:true}),
  getQuote:async()=>({status:"success",data:{"NSE_EQ:RELIANCE":entry}}),
  getCandles:async()=>({status:"success",data:{candles:[[new Date(NOW-60000).toISOString(),123,125,122,124,100]]}}),
  getDepth:async()=>null,
  getInstrumentMaster:async()=>[{instrumentId:args.instrumentId,exchange:"NSE"}],
  normalizeInstrument:x=>x,
  openStream:async()=>({close(){},subscribe(){}}),
 };
}
test("provider-neutral router accepts normalized Upstox quote, candles, depth, master and stream",async()=>{
 const adapter=createUpstoxMarketDataAdapter({client:client(),resolveInstrument:async()=>({instrumentKey:args.instrumentId}),now:()=>NOW});
 const router=new MarketDataProviderRouter({
  providers:new Map([["upstox",adapter]]),
  plan:{quote:["upstox"],candles:["upstox"],depth:["upstox"],instrumentMaster:["upstox"],stream:["upstox"]},
  entitlementResolver:async()=>({approved:true,paperTradingAllowed:true,redistributionAllowed:true,reference:"entitlement-upstox",rightsApprovalReference:"written-rights",regulatoryApprovalReference:"counsel-clearance"}),
  rightsGate:approvedRightsGate,
  healthRegistry:new ProviderHealthRegistry({clock:()=>NOW}),
  clock:()=>NOW,
 });
 assert.equal((await router.route("quote",{},args)).lastPricePaise,12345);
 assert.equal((await router.route("candles",{interval:"1m"},args)).candles[0].closePaise,12400);
 assert.equal((await router.route("depth",{},args)).bids[0].pricePaise,12340);
 assert.equal((await router.route("instrumentMaster",{},args)).instruments.length,1);
 assert.equal(typeof (await router.route("stream",{},args)).stream.close,"function");
});
test("provider-neutral router rejects data until both written approval references exist",async()=>{
 const adapter=createUpstoxMarketDataAdapter({client:client(),resolveInstrument:async()=>({instrumentKey:args.instrumentId}),now:()=>NOW});
 const router=new MarketDataProviderRouter({
  providers:new Map([["upstox",adapter]]),
  plan:{quote:["upstox"],candles:["upstox"],depth:["upstox"],instrumentMaster:["upstox"],stream:["upstox"]},
  entitlementResolver:async()=>({approved:true,paperTradingAllowed:true,redistributionAllowed:true,reference:"entitlement-upstox",rightsApprovalReference:"written-rights"}),
  rightsGate:approvedRightsGate,
  clock:()=>NOW,
 });
 await assert.rejects(router.route("quote",{},args),{code:"market_data_unavailable",status:503});
});
