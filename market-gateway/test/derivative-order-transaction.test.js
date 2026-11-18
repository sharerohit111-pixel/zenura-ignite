"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {executeLongOptionBuyTransaction}=require("../lib/derivative-order-transaction");
const {makeOrderId}=require("../lib/order-idempotency");

const now=Date.UTC(2026,10,18,10);
const uid="user-1";
const idempotencyKey="123e4567-e89b-42d3-a456-426614174000";
const orderId=makeOrderId(uid,idempotencyKey);
const instrument={
 instrument_key:"NSE_FO|NIFTY26NOV25000CE",
 trading_symbol:"NIFTY 26 NOV 25000 CE",segment:"NSE_FO",
 exchange:"NSE",instrument_type:"CE",expiry:"2026-11-26",
 strike_price:25000,lot_size:65,tick_size:0.05
};
const quote={instrumentKey:instrument.instrument_key,pricePaise:1250,observedAtMs:now-1000};
const initial={cashPaise:1000000,realizedPnlPaise:0,reservedMarginPaise:0,positions:{},version:1};
function setup({account=initial,priorOrder=null,accountExists=true}={}){
 const writes=[];
 const snaps={
  [uid]:{exists:accountExists,data:()=>({...account,positions:{...(account?.positions||{})}})},
  [orderId]:{exists:!!priorOrder,data:()=>priorOrder}
 };
 const db={runTransaction:async callback=>callback({
  get:async ref=>snaps[ref.id],
  create:(ref,data)=>writes.push(["create",ref.id,data]),
  update:(ref,data)=>writes.push(["update",ref.id,data])
 })};
 const common={db,accountRef:{id:uid},orderRef:{id:orderId},uid,idempotencyKey,
  instrument,quote,lots:1,serverTimestamp:()=>"server-time",now};
 return {common,writes};
}
test("atomically records a long option BUY and debits premium",async()=>{
 const {common,writes}=setup();
 const r=await executeLongOptionBuyTransaction(common);
 assert.equal(writes.length,2);
 assert.equal(writes[0][0],"create");
 assert.equal(writes[0][2].status,"FILLED");
 assert.equal(writes[0][2].grossPaise,81250);
 assert.equal(writes[1][0],"update");
 assert.equal(writes[1][2].cashPaise,918750);
 assert.equal(writes[1][2].positions[instrument.instrument_key].netQuantity,65);
 assert.equal(writes[1][2].version,2);
 assert.equal(r.simulationOnly,true);
 assert.equal(r.idempotentReplay,false);
});
test("replays matching idempotency key without a second debit",async()=>{
 const prior={requestFingerprint:require("../lib/order-idempotency").makeOrderFingerprint({
  instrumentKey:instrument.instrument_key,side:"BUY",quantity:65
 }),status:"FILLED"};
 const {common,writes}=setup({priorOrder:prior});
 const r=await executeLongOptionBuyTransaction(common);
 assert.equal(writes.length,0);
 assert.equal(r.idempotentReplay,true);
});
test("rejects reuse of idempotency key for a different order",async()=>{
 const {common,writes}=setup({priorOrder:{requestFingerprint:"different"}});
 await assert.rejects(executeLongOptionBuyTransaction(common),{status:409});
 assert.equal(writes.length,0);
});
test("rejects missing account and insufficient virtual cash without writes",async()=>{
 const missing=setup({accountExists:false});
 await assert.rejects(executeLongOptionBuyTransaction(missing.common),{status:409});
 assert.equal(missing.writes.length,0);
 const poor=setup({account:{...initial,cashPaise:1000}});
 await assert.rejects(executeLongOptionBuyTransaction(poor.common),{status:409});
 assert.equal(poor.writes.length,0);
});
test("rejects futures, short options, stale quotes and mismatched idempotency references",async()=>{
 for(const patch of [
  {instrument:{...instrument,instrument_type:"FUT",strike_price:0}},
  {side:"SELL"},
  {quote:{...quote,observedAtMs:now-15001}},
  {quote:{...quote,instrumentKey:"OTHER"}}
 ]){
  const {common,writes}=setup();
  Object.assign(common,patch);
  await assert.rejects(executeLongOptionBuyTransaction(common));
  assert.equal(writes.length,0);
 }
 const wrong=setup();
 wrong.common.orderRef={id:"not-the-idempotency-hash"};
 await assert.rejects(executeLongOptionBuyTransaction(wrong.common),{status:400});
 assert.equal(wrong.writes.length,0);
});
test("rejects malformed account state and future-dated quote",async()=>{
 const bad=setup({account:{...initial,cashPaise:-1}});
 await assert.rejects(executeLongOptionBuyTransaction(bad.common),{status:409});
 assert.equal(bad.writes.length,0);
 const future=setup();
 future.common.quote={...quote,observedAtMs:now+1};
 await assert.rejects(executeLongOptionBuyTransaction(future.common));
 assert.equal(future.writes.length,0);
});
