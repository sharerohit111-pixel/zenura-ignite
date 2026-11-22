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
  [orderId]:{exists:!!priorOrder,data:()=>priorOrder?(priorOrder.uid===undefined?{...priorOrder,uid}:priorOrder):priorOrder}
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
 assert.equal(writes[0][2].strikePrice,instrument.strike_price);
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
test("validates the current account on transaction-level idempotent replay",async()=>{
 const prior={requestFingerprint:require("../lib/order-idempotency").makeOrderFingerprint({
  instrumentKey:instrument.instrument_key,side:"BUY",quantity:65
 }),status:"FILLED"};
 for(const patch of [
  {accountExists:false},
  {account:{...initial,cashPaise:-1}},
  {account:{...initial,realizedPnlPaise:1.25}}
 ]){
  const {common,writes}=setup({priorOrder:prior,...patch});
  await assert.rejects(executeLongOptionBuyTransaction(common),{status:409});
  assert.equal(writes.length,0);
 }
 const legacy=setup({priorOrder:prior,account:{cashPaise:25000,version:1}});
 const replay=await executeLongOptionBuyTransaction(legacy.common);
 assert.equal(replay.idempotentReplay,true);
 assert.equal(replay.cashPaise,25000);
 assert.equal(replay.realizedPnlPaise,0);
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
test("option BUY cannot consume cash reserved by pending equity LIMIT orders",async()=>{
 const reserved=setup({account:{...initial,reservedCashPaise:950000}});
 await assert.rejects(executeLongOptionBuyTransaction(reserved.common),{status:409});
 assert.equal(reserved.writes.length,0);
 const enough=setup({account:{...initial,reservedCashPaise:900000}});
 const result=await executeLongOptionBuyTransaction(enough.common);
 assert.equal(result.cashPaise,916354);
 assert.equal(enough.writes[1][2].cashPaise,916354);
 assert.equal(enough.writes[1][2].reservedCashPaise,undefined,
   "the derivative transaction must not overwrite the existing LIMIT reservation field");
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
 const competingOrder={uid,requestFingerprint:fingerprint,status:"FILLED",grossPaise:81250};
 let attempts=0;
 const db={runTransaction:async callback=>{
  const firstTx={
   get:async ref=>ref.id===uid
    ?{exists:true,data:()=>initial}
    :{exists:false,data:()=>undefined},
   create:()=>{},update:()=>{}
  };
  await callback(firstTx); // First attempt loses a Firestore write conflict; its writes are discarded.
  attempts++;
  const retryTx={
   get:async ref=>ref.id===uid
    ?{exists:true,data:()=>({...initial,cashPaise:916354,version:2})}
    :{exists:true,data:()=>competingOrder},
   create:()=>{throw new Error("Retry must not create a duplicate order");},
   update:()=>{throw new Error("Retry must not debit cash again");}
  };
  attempts++;
  return callback(retryTx);
 }};
 const common={db,accountRef:{id:uid},orderRef:{id:orderId},uid,idempotencyKey,instrument,quote,lots:1,serverTimestamp:()=>"server-time",now};
 const result=await executeLongOptionBuyTransaction(common);
 assert.equal(attempts,2);
 assert.equal(result.idempotentReplay,true);
 assert.equal(result.cashPaise,916354);
 assert.deepEqual(result.order,competingOrder);
});


test("repeated partial option closes conserve the original paise cost basis",async()=>{
 const originalCostBasisPaise=100001;
 const account={...initial,derivativePositions:{[instrument.instrument_key]:{
  instrumentType:"CE",netQuantity:195,averagePricePaise:513,
  costBasisPaise:originalCostBasisPaise,exchange:"NSE",segment:"NSE_FO",
  expiry:"2026-11-26",lotSize:65
 }}};
 const {db,state}=createSerializableDerivativeStore(account);
 const keys=[
  "123e4567-e89b-42d3-a456-426614174008",
  "123e4567-e89b-42d3-a456-426614174009",
  "123e4567-e89b-42d3-a456-426614174010"
 ];
 const results=[];
 for(const key of keys){
  const common={
   db,accountRef:{id:uid},orderRef:{id:makeOrderId(uid,key)},uid,
   idempotencyKey:key,instrument,quote:{...quote,pricePaise:1500},
   lots:1,side:"SELL",serverTimestamp:()=>"server-time",now
  };
  results.push(await executeLongOptionBuyTransaction(common));
 }
 assert.equal(state.account.derivativePositions[instrument.instrument_key],undefined);
 assert.equal(state.account.realizedPnlPaise,
  results.reduce((sum,result)=>sum+result.order.realizedPnlPaise,0));
 const totalAllocatedCostBasis=results.reduce((sum,result)=>sum+
  (result.order.grossPaise-result.order.chargesPaise-result.order.realizedPnlPaise),0);
 assert.equal(totalAllocatedCostBasis,originalCostBasisPaise);
 assert.equal(state.orders.size,3);
});


test("rejects malformed stored option positions before applying a fill",async()=>{
 const valid={instrumentType:"CE",netQuantity:65,averagePricePaise:1287,costBasisPaise:83646,
  exchange:"NSE",segment:"NSE_FO",expiry:"2026-11-26",lotSize:65};
 const invalidPositions=[
  {...valid,netQuantity:1_000_001},
  {...valid,averagePricePaise:0},
  {...valid,averagePricePaise:undefined},
  {...valid,costBasisPaise:Number.MAX_SAFE_INTEGER+1},
  {...valid,averagePricePaise:1300},
  {...valid,exchange:"BSE"},
  {...valid,segment:"BSE_FO"},
  {...valid,expiry:"2026-12-31"},
  {...valid,lotSize:25},
  {...valid,netQuantity:0,averagePricePaise:0,costBasisPaise:1}
 ];
 for(const position of invalidPositions){
  const account={...initial,derivativePositions:{[instrument.instrument_key]:position}};
  const {common,writes}=setup({account});
  await assert.rejects(executeLongOptionBuyTransaction(common),{status:409});
  assert.equal(writes.length,0);
 }
});

test("accepts a valid legacy option position without optional contract metadata",async()=>{
 const account={...initial,derivativePositions:{[instrument.instrument_key]:{
  instrumentType:"CE",netQuantity:65,averagePricePaise:1287,costBasisPaise:83646
 }}};
 const {common,writes}=setup({account});
 common.side="SELL";
 common.quote={...quote,pricePaise:1500};
 await executeLongOptionBuyTransaction(common);
 assert.equal(writes.length,2);
 assert.deepEqual(writes[1][2].derivativePositions,{});
});


test("rejects malformed derivative position containers and stored records",async()=>{
 const malformedContainers=[null,[], "invalid", 7];
 for(const derivativePositions of malformedContainers){
  const {common,writes}=setup({account:{...initial,derivativePositions}});
  await assert.rejects(executeLongOptionBuyTransaction(common),{status:409});
  assert.equal(writes.length,0);
 }
 for(const storedPosition of [null,[], "invalid", 7]){
  const {common,writes}=setup({account:{...initial,
   derivativePositions:{[instrument.instrument_key]:storedPosition}
  }});
  await assert.rejects(executeLongOptionBuyTransaction(common),{status:409});
  assert.equal(writes.length,0);
 }
});

test("rejects SELL when cash credit would overflow safe paise arithmetic",async()=>{
 const account={...initial,cashPaise:Number.MAX_SAFE_INTEGER-1,
  derivativePositions:{[instrument.instrument_key]:{
   instrumentType:"CE",netQuantity:65,averagePricePaise:1,costBasisPaise:65
  }}};
 const {common,writes}=setup({account});
 common.side="SELL";
 common.quote={...quote,pricePaise:1500};
 await assert.rejects(executeLongOptionBuyTransaction(common),{status:409});
 assert.equal(writes.length,0);
});

test("rejects SELL when cumulative realized P&L would overflow safe paise arithmetic",async()=>{
 const account={...initial,realizedPnlPaise:Number.MAX_SAFE_INTEGER-1,
  derivativePositions:{[instrument.instrument_key]:{
   instrumentType:"CE",netQuantity:65,averagePricePaise:1,costBasisPaise:65
  }}};
 const {common,writes}=setup({account});
 common.side="SELL";
 common.quote={...quote,pricePaise:1500};
 await assert.rejects(executeLongOptionBuyTransaction(common),{status:409});
 assert.equal(writes.length,0);
});

test("rejects opening a 51st distinct derivative position before any database write",async()=>{
 const derivativePositions=Object.fromEntries(Array.from({length:50},(_,i)=>[
  `NSE_FO|OPTION${i}`,{instrumentType:"CE",netQuantity:65,averagePricePaise:100,costBasisPaise:6500}
 ]));
 const {common,writes}=setup({account:{...initial,derivativePositions}});
 await assert.rejects(executeLongOptionBuyTransaction(common),error=>error.status===409&&/50 open positions/.test(error.message));
 assert.equal(writes.length,0);
});
test("allows adding to an existing derivative position at the 50-position limit",async()=>{
 const derivativePositions=Object.fromEntries(Array.from({length:49},(_,i)=>[
  `NSE_FO|OPTION${i}`,{instrumentType:"CE",netQuantity:65,averagePricePaise:100,costBasisPaise:6500}
 ]));
 derivativePositions[instrument.instrument_key]={instrumentType:"CE",netQuantity:65,averagePricePaise:1287,costBasisPaise:83646,
  exchange:"NSE",segment:"NSE_FO",expiry:"2026-11-26",lotSize:65};
 const {common,writes}=setup({account:{...initial,derivativePositions}});
 await executeLongOptionBuyTransaction(common);
 assert.equal(writes.length,2);
 assert.equal(writes[1][2].derivativePositions[instrument.instrument_key].netQuantity,130);
});

test("rejects a new option order when another stored derivative position is malformed",async()=>{
 const derivativePositions={["NSE_FO|BROKEN"]:{instrumentType:"CE",netQuantity:65,averagePricePaise:100,costBasisPaise:1}};
 const {common,writes}=setup({account:{...initial,derivativePositions}});
 await assert.rejects(executeLongOptionBuyTransaction(common),error=>error.status===409&&/invalid cost basis/.test(error.message));
 assert.equal(writes.length,0);
});

test("rejects replay of a derivative order owned by a different account",async()=>{
 const fingerprint=require("../lib/order-idempotency").makeOrderFingerprint({instrumentKey:instrument.instrument_key,side:"BUY",quantity:65});
 const {common,writes}=setup({priorOrder:{uid:"user-2",requestFingerprint:fingerprint,status:"FILLED"}});
 await assert.rejects(executeLongOptionBuyTransaction(common),{status:409});
 assert.equal(writes.length,0);
});


test("add-on BUY accumulates fee-inclusive basis and weighted average exactly",async()=>{
 const existing={instrumentType:"CE",netQuantity:65,averagePricePaise:1287,costBasisPaise:83646,
  exchange:"NSE",segment:"NSE_FO",expiry:"2026-11-26",lotSize:65};
 const account={...initial,cashPaise:916354,
  derivativePositions:{[instrument.instrument_key]:existing}};
 const {common,writes}=setup({account});
 await executeLongOptionBuyTransaction(common);
 const next=writes[1][2].derivativePositions[instrument.instrument_key];
 assert.equal(next.netQuantity,130);
 assert.equal(next.costBasisPaise,167292);
 assert.equal(next.averagePricePaise,1287);
 assert.equal(writes[1][2].cashPaise,832708);
 assert.equal(writes[0][2].totalDebitPaise,83646);
});

