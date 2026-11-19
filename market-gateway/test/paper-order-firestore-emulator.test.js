"use strict";
const crypto=require("node:crypto");
const test=require("node:test");
const assert=require("node:assert/strict");
const {Firestore,FieldValue}=require("@google-cloud/firestore");
const {executePaperOrderTransaction}=require("../lib/paper-order-transaction");
const {consumeMarginPreviewSlot}=require("../lib/margin-preview-rate-limit");

const emulatorHost=process.env.FIRESTORE_EMULATOR_HOST;
const integrationTest=emulatorHost?test:test.skip;
const db=emulatorHost?new Firestore({projectId:process.env.GCLOUD_PROJECT||"demo-zenura-ignite"}):null;

function makeOrder({uid,accountId,orderId,fingerprint,instrumentKey="NSE_EQ|AAA",side="BUY",quantity=1,pricePaise=1000}){
 const accountRef=db.collection("emulatorPaperAccounts").doc(accountId);
 const orderRef=db.collection("emulatorPaperOrders").doc(orderId);
 const order={uid,requestFingerprint:fingerprint,instrumentKey,side,quantity,executionPricePaise:pricePaise,status:"FILLED",simulationOnly:true};
 return {db,accountRef,orderRef,uid,requestFingerprint:fingerprint,order,pricePaise,publicPaperOrder:(stored,meta)=>({order:stored,meta}),serverTimestamp:()=>FieldValue.serverTimestamp()};
}
async function seedAccount(accountRef,cashPaise,positions={}){
 await accountRef.set({cashPaise,realizedPnlPaise:0,positions,version:1});
}
async function clean(refs){
 await Promise.all(refs.map(ref=>ref.delete().catch(()=>{})));
}
integrationTest("Firestore emulator serializes concurrent duplicate orders into one fill",async()=>{
 const id=crypto.randomUUID(),uid="emulator-user-"+id;
 const common=makeOrder({uid,accountId:uid,orderId:"order-"+id,fingerprint:"same-fingerprint"});
 await seedAccount(common.accountRef,10000);
 try{
  const results=await Promise.all([executePaperOrderTransaction(common),executePaperOrderTransaction(common)]);
  const [account,order]=await Promise.all([common.accountRef.get(),common.orderRef.get()]);
  assert.equal(account.data().cashPaise,9000);
  assert.equal(account.data().positions["NSE_EQ|AAA"].quantity,1);
  assert.equal(order.exists,true);
  assert.equal(results.filter(x=>x.meta.idempotentReplay===true).length,1);
 }finally{await clean([common.accountRef,common.orderRef]);}
});

integrationTest("Firestore emulator prevents concurrent orders from overspending one account",async()=>{
 const id=crypto.randomUUID(),uid="emulator-user-"+id,accountId="acct-"+id;
 const first=makeOrder({uid,accountId:uid,orderId:"order-a-"+id,fingerprint:"fingerprint-a",instrumentKey:"NSE_EQ|AAA",pricePaise:7000});
 const second=makeOrder({uid,accountId:uid,orderId:"order-b-"+id,fingerprint:"fingerprint-b",instrumentKey:"NSE_EQ|BBB",pricePaise:7000});
 await seedAccount(first.accountRef,10000);
 try{
  const results=await Promise.allSettled([executePaperOrderTransaction(first),executePaperOrderTransaction(second)]);
  const account=await first.accountRef.get();
  const orders=await Promise.all([first.orderRef.get(),second.orderRef.get()]);
  assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(results.filter(x=>x.status==="rejected"&&x.reason.status===409).length,1);
  assert.equal(account.data().cashPaise,3000);
  assert.equal(orders.filter(x=>x.exists).length,1);
 }finally{await clean([first.accountRef,first.orderRef,second.orderRef]);}
});

integrationTest("Firestore emulator keeps paper accounts isolated by user document",async()=>{
 const id=crypto.randomUUID();
 const a=makeOrder({uid:"user-a-"+id,accountId:"user-a-"+id,orderId:"order-a-"+id,fingerprint:"fingerprint-a",pricePaise:2500});
 const b=makeOrder({uid:"user-b-"+id,accountId:"user-b-"+id,orderId:"order-b-"+id,fingerprint:"fingerprint-b",pricePaise:4000});
 await Promise.all([seedAccount(a.accountRef,10000),seedAccount(b.accountRef,10000)]);
 try{
  await Promise.all([executePaperOrderTransaction(a),executePaperOrderTransaction(b)]);
  const [accountA,accountB]=await Promise.all([a.accountRef.get(),b.accountRef.get()]);
  assert.equal(accountA.data().cashPaise,7500);
  assert.equal(accountB.data().cashPaise,6000);
  assert.equal(accountA.data().positions["NSE_EQ|AAA"].quantity,1);
  assert.equal(accountB.data().positions["NSE_EQ|AAA"].quantity,1);
 }finally{await clean([a.accountRef,a.orderRef,b.accountRef,b.orderRef]);}
});



integrationTest("Firestore emulator serializes concurrent SELL orders and prevents overselling",async()=>{
 const id=crypto.randomUUID(),uid="emulator-user-"+id;
 const first=makeOrder({uid,accountId:uid,orderId:"sell-a-"+id,fingerprint:"sell-fingerprint-a",side:"SELL",pricePaise:1000});
 const second=makeOrder({uid,accountId:uid,orderId:"sell-b-"+id,fingerprint:"sell-fingerprint-b",side:"SELL",pricePaise:1000});
 await seedAccount(first.accountRef,10000,{"NSE_EQ|AAA":{quantity:1,averagePricePaise:800}});
 try{
  const results=await Promise.allSettled([executePaperOrderTransaction(first),executePaperOrderTransaction(second)]);
  const account=await first.accountRef.get();
  const orders=await Promise.all([first.orderRef.get(),second.orderRef.get()]);
  assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(results.filter(x=>x.status==="rejected"&&x.reason.status===409).length,1);
  assert.equal(account.data().cashPaise,11000);
  assert.equal(account.data().realizedPnlPaise,200);
  assert.equal(account.data().positions["NSE_EQ|AAA"],undefined);
  assert.equal(orders.filter(x=>x.exists).length,1);
 }finally{await clean([first.accountRef,first.orderRef,second.orderRef]);}
});

integrationTest("Firestore emulator rejects a reused order key with a different fingerprint",async()=>{
 const id=crypto.randomUUID(),uid="emulator-user-"+id;
 const original=makeOrder({uid,accountId:uid,orderId:"fingerprint-"+id,fingerprint:"original-fingerprint"});
 await seedAccount(original.accountRef,10000);
 try{
  await executePaperOrderTransaction(original);
  const replay={...original,requestFingerprint:"different-fingerprint",order:{...original.order,requestFingerprint:"different-fingerprint"}};
  await assert.rejects(executePaperOrderTransaction(replay),error=>error.status===409);
  const account=await original.accountRef.get();
  assert.equal(account.data().cashPaise,9000);
 }finally{await clean([original.accountRef,original.orderRef]);}
});

integrationTest("Firestore emulator rejects paper orders when the UID account is missing",async()=>{
 const id=crypto.randomUUID(),uid="emulator-user-"+id;
 const order=makeOrder({uid,accountId:uid,orderId:"missing-"+id,fingerprint:"missing-account-fingerprint"});
 try{
  await assert.rejects(executePaperOrderTransaction(order),error=>error.status===409);
  const stored=await order.orderRef.get();
  assert.equal(stored.exists,false);
 }finally{await clean([order.accountRef,order.orderRef]);}
});

integrationTest("Firestore emulator serializes simultaneous margin preview cooldown requests per UID",async()=>{
 const uid="margin-preview-user-"+crypto.randomUUID();
 const ref=db.collection("indianMarginPreviewLimits").doc(uid);
 try{
  const results=await Promise.allSettled([
   consumeMarginPreviewSlot(db,uid),
   consumeMarginPreviewSlot(db,uid)
  ]);
  assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
  const rejected=results.find(x=>x.status==="rejected");
  assert.equal(rejected.reason.status,429);
  assert.equal(rejected.reason.retryAfterSeconds,5);
  const stored=await ref.get();
  assert.equal(stored.exists,true);
  assert.equal(Number.isSafeInteger(stored.data().lastRequestAtMs),true);
 }finally{await ref.delete().catch(()=>{});}
});

const {executeLongOptionBuyTransaction}=require("../lib/derivative-order-transaction");
const {makeOrderId}=require("../lib/order-idempotency");
const derivativeNow=Date.UTC(2026,10,18,10);
const derivativeInstrument={
 instrument_key:"NSE_FO|NIFTY26NOV25000CE",
 trading_symbol:"NIFTY 26 NOV 25000 CE",
 segment:"NSE_FO",exchange:"NSE",instrument_type:"CE",
 expiry:"2026-11-26",strike_price:25000,lot_size:65,tick_size:0.05
};
const derivativeQuote={instrumentKey:derivativeInstrument.instrument_key,pricePaise:1250,observedAtMs:derivativeNow-1000};
function makeDerivativeOrder({uid,idempotencyKey,lots=1}){
 const accountRef=db.collection("emulatorPaperAccounts").doc(uid);
 const orderRef=db.collection("emulatorDerivativeOrders").doc(makeOrderId(uid,idempotencyKey));
 return {db,accountRef,orderRef,uid,idempotencyKey,instrument:derivativeInstrument,quote:derivativeQuote,lots,serverTimestamp:()=>FieldValue.serverTimestamp(),now:derivativeNow};
}
integrationTest("Firestore emulator serializes concurrent duplicate long-option orders into one debit",async()=>{
 const uid="derivative-user-"+crypto.randomUUID();
 const key="123e4567-e89b-42d3-a456-426614174001";
 const common=makeDerivativeOrder({uid,idempotencyKey:key});
 await common.accountRef.set({cashPaise:1000000,realizedPnlPaise:0,reservedMarginPaise:0,positions:{},derivativePositions:{},version:1});
 try{
  const results=await Promise.all([executeLongOptionBuyTransaction(common),executeLongOptionBuyTransaction(common)]);
  const [account,order]=await Promise.all([common.accountRef.get(),common.orderRef.get()]);
  assert.equal(account.data().cashPaise,916354);
  assert.equal(account.data().derivativePositions[derivativeInstrument.instrument_key].netQuantity,65);
  assert.equal(order.exists,true);
  assert.equal(results.filter(x=>x.idempotentReplay===true).length,1);
 }finally{await clean([common.accountRef,common.orderRef]);}
});
integrationTest("Firestore emulator prevents concurrent different option orders from overspending shared cash",async()=>{
 const uid="derivative-user-"+crypto.randomUUID();
 const first=makeDerivativeOrder({uid,idempotencyKey:"123e4567-e89b-42d3-a456-426614174002"});
 const second=makeDerivativeOrder({uid,idempotencyKey:"123e4567-e89b-42d3-a456-426614174003"});
 await first.accountRef.set({cashPaise:100000,realizedPnlPaise:0,reservedMarginPaise:0,positions:{},derivativePositions:{},version:1});
 try{
  const results=await Promise.allSettled([executeLongOptionBuyTransaction(first),executeLongOptionBuyTransaction(second)]);
  const [account,orders]=await Promise.all([first.accountRef.get(),Promise.all([first.orderRef.get(),second.orderRef.get()])]);
  assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(results.filter(x=>x.status==="rejected"&&x.reason.status===409).length,1);
  assert.equal(account.data().cashPaise,16354);
  assert.equal(account.data().derivativePositions[derivativeInstrument.instrument_key].netQuantity,65);
  assert.equal(orders.filter(x=>x.exists).length,1);
 }finally{await clean([first.accountRef,first.orderRef,second.orderRef]);}
});
integrationTest("Firestore emulator serializes concurrent option SELL-to-close orders without overselling",async()=>{
 const uid="derivative-sell-user-"+crypto.randomUUID();
 const make=(key)=>makeDerivativeOrder({uid,idempotencyKey:key});
 const first=make("123e4567-e89b-42d3-a456-426614174004");
 const second=make("123e4567-e89b-42d3-a456-426614174005");
 const sellQuote={...derivativeQuote,pricePaise:1500};
 first.quote=sellQuote;second.quote=sellQuote;
 const initialCostBasis=167292;
 const sellCharges=require("../lib/trading-charges").calculateLongOptionTradeCharges({grossPaise:1500*65,exchange:"NSE",side:"SELL"});
 await first.accountRef.set({
  cashPaise:1000000,realizedPnlPaise:0,reservedMarginPaise:0,positions:{},
  derivativePositions:{[derivativeInstrument.instrument_key]:{
   instrumentType:"CE",netQuantity:130,averagePricePaise:1287,costBasisPaise:initialCostBasis,
   exchange:"NSE",segment:"NSE_FO",expiry:"2026-11-26",lotSize:65
  }},version:1
 });
 try{
  const results=await Promise.all([
   executeLongOptionBuyTransaction({...first,side:"SELL"}),
   executeLongOptionBuyTransaction({...second,side:"SELL"})
  ]);
  const [account,orders]=await Promise.all([first.accountRef.get(),Promise.all([first.orderRef.get(),second.orderRef.get()])]);
  assert.equal(results.length,2);
  assert.equal(account.data().cashPaise,1000000+2*(97500-sellCharges.totalChargesPaise));
  assert.equal(account.data().realizedPnlPaise,2*(97500-83646-sellCharges.totalChargesPaise));
  assert.equal(account.data().derivativePositions[derivativeInstrument.instrument_key],undefined);
  assert.equal(orders.filter(x=>x.exists).length,2);
 }finally{await clean([first.accountRef,first.orderRef,second.orderRef]);}
});
integrationTest("Firestore emulator prevents concurrent option SELL orders from opening a short position",async()=>{
 const uid="derivative-oversell-user-"+crypto.randomUUID();
 const first=makeDerivativeOrder({uid,idempotencyKey:"123e4567-e89b-42d3-a456-426614174006"});
 const second=makeDerivativeOrder({uid,idempotencyKey:"123e4567-e89b-42d3-a456-426614174007"});
 await first.accountRef.set({
  cashPaise:1000000,realizedPnlPaise:0,reservedMarginPaise:0,positions:{},
  derivativePositions:{[derivativeInstrument.instrument_key]:{
   instrumentType:"CE",netQuantity:65,averagePricePaise:1287,costBasisPaise:83646,
   exchange:"NSE",segment:"NSE_FO",expiry:"2026-11-26",lotSize:65
  }},version:1
 });
 try{
  const results=await Promise.allSettled([
   executeLongOptionBuyTransaction({...first,side:"SELL"}),
   executeLongOptionBuyTransaction({...second,side:"SELL"})
  ]);
  const [account,orders]=await Promise.all([first.accountRef.get(),Promise.all([first.orderRef.get(),second.orderRef.get()])]);
  assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(results.filter(x=>x.status==="rejected"&&x.reason.status===409).length,1);
  assert.equal(account.data().derivativePositions[derivativeInstrument.instrument_key],undefined);
  assert.equal(orders.filter(x=>x.exists).length,1);
 }finally{await clean([first.accountRef,first.orderRef,second.orderRef]);}
});

const {acquireStreamLease,renewStreamLease,releaseStreamLease}=require("../lib/stream-lease");
integrationTest("Firestore emulator serializes competing stream leases and enforces owner-only cleanup",async()=>{
 const uid="stream-lease-user-"+crypto.randomUUID();
 const ref=db.collection("indianMarketStreamLeases").doc(uid);
 const now=Date.now();
 try{
  const acquisitions=await Promise.all([
   acquireStreamLease(db,uid,"lease-a",{now,leaseMs:60000}),
   acquireStreamLease(db,uid,"lease-b",{now,leaseMs:60000})
  ]);
  assert.equal(acquisitions.filter(Boolean).length,1);
  const stored=await ref.get();
  assert.equal(stored.exists,true);
  const owner=stored.data().leaseId;
  const other=owner==="lease-a"?"lease-b":"lease-a";
  assert.equal(await renewStreamLease(db,uid,other,{now:now+1000,leaseMs:60000}),false);
  assert.equal(await renewStreamLease(db,uid,owner,{now:now+1000,leaseMs:60000}),true);
  assert.equal(await releaseStreamLease(db,uid,other),false);
  assert.equal((await ref.get()).exists,true);
  assert.equal(await releaseStreamLease(db,uid,owner),true);
  assert.equal((await ref.get()).exists,false);
  assert.equal(await acquireStreamLease(db,uid,"lease-reconnected",{now:now+2000,leaseMs:60000}),true);
  assert.equal((await ref.get()).data().leaseId,"lease-reconnected");
 }finally{await ref.delete().catch(()=>{});}
});


integrationTest("Firestore emulator rejects a 51st distinct derivative position atomically",async()=>{
 const uid="derivative-limit-user-"+crypto.randomUUID();
 const common=makeDerivativeOrder({uid,idempotencyKey:crypto.randomUUID()});
 const derivativePositions=Object.fromEntries(Array.from({length:50},(_,i)=>[
  `NSE_FO|EXISTING${i}`,{instrumentType:"CE",netQuantity:65,averagePricePaise:100,costBasisPaise:6500}
 ]));
 await common.accountRef.set({cashPaise:1000000,realizedPnlPaise:0,reservedMarginPaise:0,positions:{},derivativePositions,version:1});
 try{
  await assert.rejects(executeLongOptionBuyTransaction(common),error=>error.status===409&&/50 open positions/.test(error.message));
  const [account,order]=await Promise.all([common.accountRef.get(),common.orderRef.get()]);
  assert.equal(account.data().cashPaise,1000000);
  assert.equal(Object.keys(account.data().derivativePositions).length,50);
  assert.equal(order.exists,false);
 }finally{await clean([common.accountRef,common.orderRef]);}
});

integrationTest("Firestore emulator allows adding to an existing derivative position at 50 open positions",async()=>{
 const uid="derivative-limit-add-user-"+crypto.randomUUID();
 const common=makeDerivativeOrder({uid,idempotencyKey:crypto.randomUUID()});
 const derivativePositions=Object.fromEntries(Array.from({length:49},(_,i)=>[
  `NSE_FO|EXISTING${i}`,{instrumentType:"CE",netQuantity:65,averagePricePaise:100,costBasisPaise:6500}
 ]));
 derivativePositions[derivativeInstrument.instrument_key]={
  instrumentType:"CE",netQuantity:65,averagePricePaise:1287,costBasisPaise:83646,
  exchange:"NSE",segment:"NSE_FO",expiry:"2026-11-26",lotSize:65
 };
 await common.accountRef.set({cashPaise:1000000,realizedPnlPaise:0,reservedMarginPaise:0,positions:{},derivativePositions,version:1});
 try{
  await executeLongOptionBuyTransaction(common);
  const account=await common.accountRef.get();
  assert.equal(account.data().cashPaise,916354);
  assert.equal(Object.keys(account.data().derivativePositions).length,50);
  assert.equal(account.data().derivativePositions[derivativeInstrument.instrument_key].netQuantity,130);
 }finally{await clean([common.accountRef,common.orderRef]);}
});


integrationTest("Firestore emulator isolates stream leases and disconnect cleanup across different UIDs",async()=>{
 const suffix=crypto.randomUUID();
 const uidA="stream-user-a-"+suffix,uidB="stream-user-b-"+suffix;
 const refA=db.collection("indianMarketStreamLeases").doc(uidA);
 const refB=db.collection("indianMarketStreamLeases").doc(uidB);
 const now=Date.now();
 try{
  const acquired=await Promise.all([
   acquireStreamLease(db,uidA,"lease-a",{now,leaseMs:60000}),
   acquireStreamLease(db,uidB,"lease-b",{now,leaseMs:60000})
  ]);
  assert.deepEqual(acquired,[true,true]);
  assert.equal((await refA.get()).data().uid,uidA);
  assert.equal((await refB.get()).data().uid,uidB);
  // Revoking or releasing one account's lease must not affect the other user's lease.
  await refA.update({revoked:true});
  assert.equal(await renewStreamLease(db,uidA,"lease-a",{now:now+1000,leaseMs:60000}),false);
  assert.equal(await renewStreamLease(db,uidB,"lease-b",{now:now+1000,leaseMs:60000}),true);
  assert.equal(await releaseStreamLease(db,uidA,"lease-b"),false);
  assert.equal((await refB.get()).exists,true);
  assert.equal(await releaseStreamLease(db,uidB,"lease-b"),true);
  assert.equal((await refB.get()).exists,false);
  assert.equal((await refA.get()).data().revoked,true);
 }finally{await clean([refA,refB]);}
});
