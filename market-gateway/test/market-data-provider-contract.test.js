"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {REQUIRED_MARKET_DATA_METHODS,assertMarketDataProvider,normalizeMarketDataSnapshot}=require("../lib/market-data-provider-contract");
const NOW=1_800_000_000_000;
function snapshot(overrides={}) {
 return {
  providerId:"upstox",instrumentId:"NSE_EQ|INE001A01036",exchange:"NSE",
  lastPricePaise:12345,receivedAtMs:NOW,exchangeTimestampMs:NOW-100,
  lastTradeTimestampMs:NOW-100,sourceSequence:"seq-1",
  entitlementReference:"entitlement-ref-1",attribution:{displayName:"Upstox"},...overrides
 };
}
test("provider adapter must implement the complete provider-neutral contract",()=>{
 const provider={providerId:"upstox"};
 for(const method of REQUIRED_MARKET_DATA_METHODS)provider[method]=()=>{};
 assert.equal(assertMarketDataProvider(provider),provider);
 delete provider.openStream;
 assert.throws(()=>assertMarketDataProvider(provider),/openStream/);
});
test("rejects a snapshot attributed to a different provider (synthetic/real boundary)",()=>{
 assert.throws(()=>normalizeMarketDataSnapshot(snapshot({providerId:"synthetic-demo"}),{
  expectedProviderId:"upstox",expectedInstrumentId:"NSE_EQ|INE001A01036",nowMs:NOW
 }),{code:"invalid_market_data"});
});
test("rejects a real-provider snapshot when the selected provider is synthetic",()=>{
 assert.throws(()=>normalizeMarketDataSnapshot(snapshot(),{
  expectedProviderId:"synthetic-demo",expectedInstrumentId:"NSE_EQ|INE001A01036",nowMs:NOW
 }),{code:"invalid_market_data"});
});
test("rejects instrument substitution across the provider boundary",()=>{
 assert.throws(()=>normalizeMarketDataSnapshot(snapshot(),{
  expectedProviderId:"upstox",expectedInstrumentId:"BSE_EQ|INE001A01036",nowMs:NOW
 }),{code:"invalid_market_data"});
});
test("rejects stale, future-dated and missing entitlement snapshots",()=>{
 for(const patch of [
  {receivedAtMs:NOW-15001},{receivedAtMs:NOW+1},
  {exchangeTimestampMs:NOW+1},{entitlementReference:" "}
 ]) assert.throws(()=>normalizeMarketDataSnapshot(snapshot(patch),{
  expectedProviderId:"upstox",expectedInstrumentId:"NSE_EQ|INE001A01036",nowMs:NOW
 }));
});
test("accepts only a fresh attributed snapshot for the selected provider and instrument",()=>{
 const accepted=normalizeMarketDataSnapshot(snapshot(),{
  expectedProviderId:"upstox",expectedInstrumentId:"NSE_EQ|INE001A01036",nowMs:NOW
 });
 assert.equal(accepted.providerId,"upstox");
 assert.equal(accepted.lastPricePaise,12345);
});
