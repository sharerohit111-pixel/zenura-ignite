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
const initial={cashPaise:1000000,realizedPnlPaise:0,reservedMarginPaise:0,positions:{},derivativePositions:{},version:1};
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
 assert.equal(writes[1][2].cashPaise,916354);
 assert.equal(writes[0][2].chargesPaise,2396);
 assert.equal(writes[0][2].totalDebitPaise,83646);
 assert.equal(writes[1][2].derivativePositions[instrument.instrument_key].netQuantity,65);
 assert.equal(writes[1][2].derivativePositions[instrument.instrument_key].averagePricePaise,1287);
 assert.equal(writes[1][2].derivativePositions[instrument.instrument_key].costBasisPaise,83646);
 assert.equal(writes[1][2].version,2);
 assert.equal(r.simulationOnly,true);
 assert.equal(r.idempotentReplay,false);
});
test("shares the equity account cash while keeping equity and derivative holdings separate",async()=>{
 const equityPosition={"NSE_EQ|RELIANCE":{quantity:3,averagePricePaise:250000}};
 const {common,writes}=setup({account:{...initial,positions:equityPosition}});
 await executeLongOptionBuyTransaction(common);
 assert.equal(writes[1][2].positions,undefined,"the transaction must leave the existing cash-equity holdings field untouched");
 assert.equal(writes[1][2].cashPaise,916354);
 assert.equal(writes[1][2].derivativePositions[instrument.instrument_key].netQuantity,65);
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
test("rejects futures, stale quotes and mismatched idempotency references",async()=>{
 for(const patch of [
  {instrument:{...instrument,instrument_type:"FUT",strike_price:0}},
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

test("SELL closes a long option, credits premium net of estimated charges, and realizes P&L",async()=>{
 const account={...initial,derivativePositions:{[instrument.instrument_key]:{
  instrumentType:"CE",netQuantity:65,averagePricePaise:1287,costBasisPaise:83646,exchange:"NSE",segment:"NSE_FO",expiry:"2026-11-26",lotSize:65
 }}};
 const {common,writes}=setup({account});
 common.side="SELL";
 common.quote={...quote,pricePaise:1500};
 const r=await executeLongOptionBuyTransaction(common);
 assert.equal(writes[0][2].side,"SELL");
 assert.equal(writes[0][2].charges.sttPaise,146);
 assert.equal(writes[0][2].netCreditPaise,94953);
 assert.equal(writes[1][2].cashPaise,1094953);
 assert.deepEqual(writes[1][2].derivativePositions,{});
 assert.equal(writes[1][2].realizedPnlPaise,11307);
 assert.equal(r.idempotentReplay,false);
});

test("SELL cannot open a short option or exceed an existing long position",async()=>{
 const {common,writes}=setup();
 common.side="SELL";
 await assert.rejects(executeLongOptionBuyTransaction(common),{status:409});
 assert.equal(writes.length,0);
 const account={...initial,derivativePositions:{[instrument.instrument_key]:{
  instrumentType:"CE",netQuantity:65,averagePricePaise:1250
 }}};
 const tooMany=setup({account});
 tooMany.common.side="SELL";
 tooMany.common.lots=2;
 await assert.rejects(executeLongOptionBuyTransaction(tooMany.common),{status:409});
 assert.equal(tooMany.writes.length,0);
});

test("partial option SELL allocates exact entry cost basis and retains the remainder",async()=>{
 const account={...initial,derivativePositions:{[instrument.instrument_key]:{
  instrumentType:"CE",netQuantity:130,averagePricePaise:1287,costBasisPaise:167292,
  exchange:"NSE",segment:"NSE_FO",expiry:"2026-11-26",lotSize:65
 }}};
 const {common,writes}=setup({account});
 common.side="SELL";
 common.quote={...quote,pricePaise:1500};
 await executeLongOptionBuyTransaction(common);
 const remaining=writes[1][2].derivativePositions[instrument.instrument_key];
 assert.equal(remaining.netQuantity,65);
 assert.equal(remaining.costBasisPaise,83646);
 assert.equal(remaining.averagePricePaise,1287);
 assert.equal(writes[1][2].realizedPnlPaise,11307);
});

function createSerializableDerivativeStore(initialAccount){
 const state={account:{...initialAccount,derivativePositions:{...(initialAccount.derivativePositions||{})}},orders:new Map()};
 let tail=Promise.resolve();
 const db={runTransaction(callback){
  const run=tail.then(async()=>{
   const writes=[];
   const tx={
    get:async ref=>{
     if(ref.id===uid)return {exists:true,data:()=>({...state.account,derivativePositions:{...state.account.derivativePositions}})};
     const value=state.orders.get(ref.id);
     return {exists:!!value,data:()=>value};
    },
    create:(ref,data)=>writes.push(()=>{if(state.orders.has(ref.id))throw new Error("duplicate order create");state.orders.set(ref.id,data);}),
    update:(ref,data)=>writes.push(()=>{state.account={...state.account,...data};})
   };
   const result=await callback(tx);
   for(const write of writes)write();
   return result;
  });
  tail=run.catch(()=>{});
  return run;
 }};
 return {db,state};
}

test("concurrent identical option submissions create one fill and one premium debit",async()=>{
 const {db,state}=createSerializableDerivativeStore(initial);
 const common={db,accountRef:{id:uid},orderRef:{id:orderId},uid,idempotencyKey,instrument,quote,lots:1,serverTimestamp:()=>"server-time",now};
 const results=await Promise.all([
  executeLongOptionBuyTransaction(common),
  executeLongOptionBuyTransaction(common)
 ]);
 assert.equal(state.orders.size,1);
 assert.equal(state.account.cashPaise,916354);
 assert.equal(state.account.derivativePositions[instrument.instrument_key].netQuantity,65);
 assert.deepEqual(results.map(x=>x.idempotentReplay).sort(),[false,true]);
});

test("concurrent different option BUY orders cannot overspend shared virtual cash",async()=>{
 const poorAccount={...initial,cashPaise:100000};
 const {db,state}=createSerializableDerivativeStore(poorAccount);
 const make=(key)=>({
  db,accountRef:{id:uid},orderRef:{id:makeOrderId(uid,key)},uid,idempotencyKey:key,
  instrument,quote,lots:1,serverTimestamp:()=>"server-time",now
 });
 const keys=["123e4567-e89b-42d3-a456-426614174001","123e4567-e89b-42d3-a456-426614174002"];
 const results=await Promise.allSettled(keys.map(key=>executeLongOptionBuyTransaction(make(key))));
 assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
 assert.equal(results.filter(x=>x.status==="rejected"&&x.reason.status===409).length,1);
 assert.equal(state.orders.size,1);
 assert.equal(state.account.cashPaise,16354);
 assert.equal(state.account.derivativePositions[instrument.instrument_key].netQuantity,65);
});

test("Firestore transaction retry re-reads a competing committed order before replay",async()=>{
 const fingerprint=require("../lib/order-idempotency").makeOrderFingerprint({
  instrumentKey:instrument.instrument_key,side:"BUY",quantity:65
 });
 const competingOrder={requestFingerprint:fingerprint,status:"FILLED",grossPaise:81250};
 let attempts=0;
 const committedWrites=[];
 const db={runTransaction:async callback=>{
  attempts++;
  const hasCompetingOrder=attempts>1;
  const tx={
   get:async ref=>{
    if(ref.id===uid)return {exists:true,data:()=>({...initial,cashPaise:916354,realizedPnlPaise:0,version:2})};
    return {exists:hasCompetingOrder,data:()=>competingOrder};
   },
   create:(ref,data)=>{if(!hasCompetingOrder)committedWrites.push(["create",ref.id,data]);},
   update:(ref,data)=>{if(!hasCompetingOrder)committedWrites.push(["update",ref.id,data]);}
  };
  const result=await callback(tx);
  return result;
 }};
 const common={db,accountRef:{id:uid},orderRef:{id:orderId},uid,idempotencyKey,instrument,quote,lots:1,serverTimestamp:()=>"server-time",now};
 const result=await executeLongOptionBuyTransaction(common);
 assert.equal(attempts,1);
 assert.equal(result.idempotentReplay,false);
});
