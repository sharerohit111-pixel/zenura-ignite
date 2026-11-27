"use strict";
const crypto=require("node:crypto");
const test=require("node:test");
const assert=require("node:assert/strict");
const {Firestore,FieldValue}=require("@google-cloud/firestore");
const {executePaperOrderTransaction}=require("../lib/paper-order-transaction");
const {placePendingLimitOrder,cancelPendingLimitOrder,executePendingLimitOrder}=require("../lib/pending-limit-order-transaction");
const {executePendingLimitOrderInWorker}=require("../../functions/lib/pending-limit-order-worker");
const {consumeMarginPreviewSlot}=require("../lib/margin-preview-rate-limit");
const {mergeWatchlistUpdate}=require("../lib/watchlists");

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
integrationTest("Firestore emulator serializes concurrent LIMIT cancellation and execution",async()=>{
 const id=crypto.randomUUID(),uid="limit-race-user-"+id;
 const accountRef=db.collection("emulatorPaperAccounts").doc(uid);
 const orderRef=db.collection("emulatorPaperOrders").doc("limit-"+id);
 const serverTimestamp=()=>FieldValue.serverTimestamp();
 await accountRef.set({cashPaise:100000,reservedCashPaise:0,reservedMarginPaise:0,realizedPnlPaise:0,positions:{},reservedPositions:{},version:1});
 try{
  await placePendingLimitOrder({
   db,accountRef,orderRef,uid,
   order:{uid,instrumentKey:"NSE_EQ|AAA",tradingSymbol:"AAA",exchange:"NSE",side:"BUY",quantity:2,orderType:"LIMIT",limitPricePaise:10000,status:"PENDING",simulationOnly:true},
   serverTimestamp
  });
  const nowMs=Date.now();
  const quote={pricePaise:9000,timestampMs:nowMs-500};
  const results=await Promise.allSettled([
   cancelPendingLimitOrder({db,accountRef,orderRef,uid,serverTimestamp}),
   executePendingLimitOrder({db,accountRef,orderRef,uid,quote,nowMs,serverTimestamp})
  ]);
  const [account,order]=await Promise.all([accountRef.get(),orderRef.get()]);
  const stored=order.data(),state=account.data();
  assert.equal(order.exists,true);
  assert.ok(["CANCELLED","FILLED"].includes(stored.status));
  if(stored.status==="CANCELLED"){
   assert.equal(results[0].status,"fulfilled");
   assert.equal(state.reservedCashPaise,0);
   assert.equal(state.cashPaise,100000);
   assert.equal(state.positions["NSE_EQ|AAA"],undefined);
   assert.ok(results[1].status==="fulfilled"&&results[1].value.status==="CANCELLED"||
     results[1].status==="rejected"&&results[1].reason.status===409);
  }else{
   assert.equal(results[1].status,"fulfilled");
   assert.equal(state.reservedCashPaise,0);
   assert.equal(state.cashPaise,82000);
   assert.equal(state.positions["NSE_EQ|AAA"].quantity,2);
   assert.ok(results[0].status==="rejected"&&results[0].reason.status===409);
  }
 }finally{await clean([accountRef,orderRef]);}
});

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


integrationTest("Firestore emulator isolates named watchlists across different UIDs",async()=>{
 const id=crypto.randomUUID();
 const uidA="watchlist-user-a-"+id,uidB="watchlist-user-b-"+id;
 const refA=db.collection("indianMarketWatchlists").doc(uidA);
 const refB=db.collection("indianMarketWatchlists").doc(uidB);
 const initialA={uid:uidA,watchlists:{"My Stocks":["NSE_EQ|AAA"],Banking:["NSE_EQ|BANKA"]}};
 const initialB={uid:uidB,watchlists:{"My Stocks":["NSE_EQ|BBB"],Banking:["NSE_EQ|BANKB"]}};
 try{
  await Promise.all([refA.set(initialA),refB.set(initialB)]);
  await Promise.all([
   db.runTransaction(async tx=>{
    const snap=await tx.get(refA);
    const data=snap.exists?snap.data():{};
    tx.set(refA,{uid:uidA,watchlists:mergeWatchlistUpdate(data,"Banking",["NSE_EQ|BANKA2"])},{merge:true});
   }),
   db.runTransaction(async tx=>{
    const snap=await tx.get(refB);
    const data=snap.exists?snap.data():{};
    tx.set(refB,{uid:uidB,watchlists:mergeWatchlistUpdate(data,"My Stocks",["NSE_EQ|BBB2"])},{merge:true});
   })
  ]);
  const [storedA,storedB]=await Promise.all([refA.get(),refB.get()]);
  assert.equal(storedA.data().uid,uidA);
  assert.equal(storedB.data().uid,uidB);
  assert.deepEqual(storedA.data().watchlists["My Stocks"],["NSE_EQ|AAA"]);
  assert.deepEqual(storedA.data().watchlists.Banking,["NSE_EQ|BANKA2"]);
  assert.deepEqual(storedB.data().watchlists["My Stocks"],["NSE_EQ|BBB2"]);
  assert.deepEqual(storedB.data().watchlists.Banking,["NSE_EQ|BANKB"]);
 }finally{await clean([refA,refB]);}
});


integrationTest("Firestore emulator preserves concurrent updates to different watchlists in the same UID document",async()=>{
 const uid="watchlist-concurrent-user-"+crypto.randomUUID();
 const ref=db.collection("indianMarketWatchlists").doc(uid);
 await ref.set({uid,watchlists:{"My Stocks":["NSE_EQ|AAA"],Banking:["NSE_EQ|BANKA"]}});
 try{
  await Promise.all([
   db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    const data=snap.exists?snap.data():{};
    tx.set(ref,{uid,watchlists:mergeWatchlistUpdate(data,"My Stocks",["NSE_EQ|AAA2"])},{merge:true});
   }),
   db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    const data=snap.exists?snap.data():{};
    tx.set(ref,{uid,watchlists:mergeWatchlistUpdate(data,"Banking",["NSE_EQ|BANKA2"])},{merge:true});
   })
  ]);
  const stored=await ref.get(),data=stored.data();
  assert.equal(data.uid,uid);
  assert.deepEqual(data.watchlists["My Stocks"],["NSE_EQ|AAA2"]);
  assert.deepEqual(data.watchlists.Banking,["NSE_EQ|BANKA2"]);
 }finally{await ref.delete().catch(()=>{});}
});


integrationTest("Firestore emulator atomically reserves and fills a LIMIT BUY",async()=>{
 const id=crypto.randomUUID(),uid="limit-buy-emulator-"+id;
 const accountRef=db.collection("emulatorPaperAccounts").doc(uid);
 const orderRef=db.collection("emulatorPaperOrders").doc("limit-buy-"+id);
 const serverTimestamp=()=>FieldValue.serverTimestamp();
 await accountRef.set({cashPaise:100000,reservedCashPaise:0,reservedMarginPaise:0,realizedPnlPaise:0,positions:{},reservedPositions:{},version:1});
 try{
  const placed=await placePendingLimitOrder({db,accountRef,orderRef,uid,order:{uid,instrumentKey:"NSE_EQ|AAA",tradingSymbol:"AAA",exchange:"NSE",side:"BUY",quantity:2,orderType:"LIMIT",limitPricePaise:10000,status:"PENDING",simulationOnly:true},serverTimestamp});
  assert.equal(placed.status,"PENDING");
  let account=(await accountRef.get()).data();
  assert.equal(account.cashPaise,100000);
  assert.equal(account.reservedCashPaise,20000);
  assert.deepEqual(account.reservedPositions,{});
  const filled=await executePendingLimitOrder({db,accountRef,orderRef,uid,quote:{pricePaise:9000,timestampMs:Date.now()-500},nowMs:Date.now(),serverTimestamp});
  assert.equal(filled.status,"FILLED");
  account=(await accountRef.get()).data();
  assert.equal(account.cashPaise,82000);
  assert.equal(account.reservedCashPaise,0);
  assert.equal(account.positions["NSE_EQ|AAA"].quantity,2);
  assert.equal((await orderRef.get()).data().reservationReleased,true);
 }finally{await clean([accountRef,orderRef]);}
});

integrationTest("Firestore emulator atomically reserves and fills a LIMIT SELL",async()=>{
 const id=crypto.randomUUID(),uid="limit-sell-emulator-"+id;
 const accountRef=db.collection("emulatorPaperAccounts").doc(uid);
 const orderRef=db.collection("emulatorPaperOrders").doc("limit-sell-"+id);
 const serverTimestamp=()=>FieldValue.serverTimestamp();
 await accountRef.set({cashPaise:100000,reservedCashPaise:0,reservedMarginPaise:0,realizedPnlPaise:0,positions:{"NSE_EQ|AAA":{quantity:5,averagePricePaise:8000}},reservedPositions:{},version:1});
 try{
  const placed=await placePendingLimitOrder({db,accountRef,orderRef,uid,order:{uid,instrumentKey:"NSE_EQ|AAA",tradingSymbol:"AAA",exchange:"NSE",side:"SELL",quantity:2,orderType:"LIMIT",limitPricePaise:10000,status:"PENDING",simulationOnly:true},serverTimestamp});
  assert.equal(placed.reservedQuantity,2);
  let account=(await accountRef.get()).data();
  assert.deepEqual(account.reservedPositions,{"NSE_EQ|AAA":2});
  const filled=await executePendingLimitOrder({db,accountRef,orderRef,uid,quote:{pricePaise:11000,timestampMs:Date.now()-500},nowMs:Date.now(),serverTimestamp});
  assert.equal(filled.status,"FILLED");
  account=(await accountRef.get()).data();
  assert.equal(account.cashPaise,122000);
  assert.equal(account.positions["NSE_EQ|AAA"].quantity,3);
  assert.deepEqual(account.reservedPositions,{});
  assert.equal((await orderRef.get()).data().reservationReleased,true);
 }finally{await clean([accountRef,orderRef]);}
});

integrationTest("Firestore emulator leaves stale LIMIT quotes pending without changing reservations",async()=>{
 const id=crypto.randomUUID(),uid="limit-stale-emulator-"+id;
 const accountRef=db.collection("emulatorPaperAccounts").doc(uid);
 const orderRef=db.collection("emulatorPaperOrders").doc("limit-stale-"+id);
 const serverTimestamp=()=>FieldValue.serverTimestamp(),nowMs=Date.now();
 await accountRef.set({cashPaise:100000,reservedCashPaise:0,reservedMarginPaise:0,realizedPnlPaise:0,positions:{},reservedPositions:{},version:1});
 try{
  await placePendingLimitOrder({db,accountRef,orderRef,uid,order:{uid,instrumentKey:"NSE_EQ|AAA",tradingSymbol:"AAA",exchange:"NSE",side:"BUY",quantity:2,orderType:"LIMIT",limitPricePaise:10000,status:"PENDING",simulationOnly:true},serverTimestamp});
  const before=(await accountRef.get()).data();
  const result=await executePendingLimitOrder({db,accountRef,orderRef,uid,quote:{pricePaise:9000,timestampMs:nowMs-16000},nowMs,serverTimestamp});
  const [account,order]=await Promise.all([accountRef.get(),orderRef.get()]);
  assert.equal(result.status,"PENDING");
  assert.equal(result.notExecuted,true);
  assert.equal(order.data().status,"PENDING");
  assert.equal(account.data().cashPaise,before.cashPaise);
  assert.equal(account.data().reservedCashPaise,before.reservedCashPaise);
  assert.equal(account.data().positions["NSE_EQ|AAA"],undefined);
 }finally{await clean([accountRef,orderRef]);}
});

integrationTest("Firestore emulator makes repeated LIMIT cancellation release reservations only once",async()=>{
 const id=crypto.randomUUID(),uid="limit-cancel-emulator-"+id;
 const accountRef=db.collection("emulatorPaperAccounts").doc(uid);
 const orderRef=db.collection("emulatorPaperOrders").doc("limit-cancel-"+id);
 const serverTimestamp=()=>FieldValue.serverTimestamp();
 await accountRef.set({cashPaise:100000,reservedCashPaise:0,reservedMarginPaise:0,realizedPnlPaise:0,positions:{},reservedPositions:{},version:1});
 try{
  await placePendingLimitOrder({db,accountRef,orderRef,uid,order:{uid,instrumentKey:"NSE_EQ|AAA",tradingSymbol:"AAA",exchange:"NSE",side:"BUY",quantity:2,orderType:"LIMIT",limitPricePaise:10000,status:"PENDING",simulationOnly:true},serverTimestamp});
  const first=await cancelPendingLimitOrder({db,accountRef,orderRef,uid,serverTimestamp});
  const second=await cancelPendingLimitOrder({db,accountRef,orderRef,uid,serverTimestamp});
  const [account,order]=await Promise.all([accountRef.get(),orderRef.get()]);
  assert.equal(first.reservationReleased,true);
  assert.equal(second.idempotentReplay,true);
  assert.equal(account.data().cashPaise,100000);
  assert.equal(account.data().reservedCashPaise,0);
  assert.equal(order.data().status,"CANCELLED");
  assert.equal(order.data().reservationReleased,true);
 }finally{await clean([accountRef,orderRef]);}
});


integrationTest("Firestore emulator serializes duplicate scheduled-worker executions into one LIMIT fill",async()=>{
 const id=crypto.randomUUID(),uid="worker-limit-duplicate-"+id;
 const accountRef=db.collection("indianPaperAccounts").doc(uid);
 const orderRef=db.collection("emulatorPaperOrders").doc("worker-limit-"+id);
 const nowMs=Date.now(),quote={pricePaise:9500,timestampMs:nowMs-500};
 await accountRef.set({cashPaise:100000,reservedCashPaise:20000,reservedMarginPaise:0,realizedPnlPaise:0,positions:{},reservedPositions:{},version:1});
 await orderRef.set({uid,instrumentKey:"NSE_EQ|AAA",side:"BUY",quantity:2,orderType:"LIMIT",limitPricePaise:10000,status:"PENDING",simulationOnly:true,reservedCashPaise:20000,reservedQuantity:0});
 try{
  const original=(await orderRef.get()).data();
  const results=await Promise.allSettled([
   executePendingLimitOrderInWorker({db,orderRef,order:original,quote,nowMs,serverTimestamp:()=>FieldValue.serverTimestamp()}),
   executePendingLimitOrderInWorker({db,orderRef,order:original,quote,nowMs,serverTimestamp:()=>FieldValue.serverTimestamp()})
  ]);
  const [account,order]=await Promise.all([accountRef.get(),orderRef.get()]);
  assert.equal(order.data().status,"FILLED");
  assert.equal(results.filter(value=>value.status==="fulfilled"&&value.value==="FILLED").length,1);
  assert.ok(results.every(value=>
   (value.status==="fulfilled"&&["FILLED","ALREADY_FILLED"].includes(value.value))||
   (value.status==="rejected"&&[3,10].includes(value.reason?.code))
  ));
  const replay=await executePendingLimitOrderInWorker({db,orderRef,order:original,quote,nowMs,serverTimestamp:()=>FieldValue.serverTimestamp()});
  assert.equal(replay,"ALREADY_FILLED");
  assert.equal(account.data().cashPaise,81000);
  assert.equal(account.data().reservedCashPaise,0);
  assert.equal(account.data().positions["NSE_EQ|AAA"].quantity,2);
 }finally{await clean([accountRef,orderRef]);}
});

integrationTest("Firestore emulator serializes scheduled-worker fill against LIMIT cancellation",async()=>{
 const id=crypto.randomUUID(),uid="worker-limit-cancel-"+id;
 const accountRef=db.collection("indianPaperAccounts").doc(uid);
 const orderRef=db.collection("emulatorPaperOrders").doc("worker-limit-cancel-"+id);
 const serverTimestamp=()=>FieldValue.serverTimestamp(),nowMs=Date.now();
 const quote={pricePaise:9500,timestampMs:nowMs-500};
 await accountRef.set({cashPaise:100000,reservedCashPaise:20000,reservedMarginPaise:0,realizedPnlPaise:0,positions:{},reservedPositions:{},version:1});
 await orderRef.set({uid,instrumentKey:"NSE_EQ|AAA",side:"BUY",quantity:2,orderType:"LIMIT",limitPricePaise:10000,status:"PENDING",simulationOnly:true,reservedCashPaise:20000,reservedQuantity:0});
 try{
  const results=await Promise.allSettled([
   cancelPendingLimitOrder({db,accountRef,orderRef,uid,serverTimestamp}),
   executePendingLimitOrderInWorker({db,orderRef,order:(await orderRef.get()).data(),quote,nowMs,serverTimestamp})
  ]);
  const [account,order]=await Promise.all([accountRef.get(),orderRef.get()]);
  const stored=order.data(),state=account.data();
  assert.ok(["CANCELLED","FILLED"].includes(stored.status));
  assert.equal(state.reservedCashPaise,0);
  if(stored.status==="CANCELLED"){
   assert.equal(state.cashPaise,100000);
   assert.equal(state.positions["NSE_EQ|AAA"],undefined);
   assert.ok(results.some(result=>result.status==="fulfilled"&&result.value?.status==="CANCELLED"));
  }else{
   assert.equal(state.cashPaise,81000);
   assert.equal(state.positions["NSE_EQ|AAA"].quantity,2);
   assert.ok(results.some(result=>result.status==="fulfilled"&&result.value==="FILLED"));
  }
 }finally{await clean([accountRef,orderRef]);}
});

integrationTest("Firestore emulator serializes scheduled-worker SELL fill against LIMIT cancellation",async()=>{
 const id=crypto.randomUUID(),uid="worker-limit-sell-cancel-"+id;
 const accountRef=db.collection("indianPaperAccounts").doc(uid);
 const orderRef=db.collection("emulatorPaperOrders").doc("worker-limit-sell-cancel-"+id);
 const serverTimestamp=()=>FieldValue.serverTimestamp(),nowMs=Date.now();
 const quote={pricePaise:10500,timestampMs:nowMs-500};
 await accountRef.set({
  cashPaise:100000,reservedCashPaise:0,reservedMarginPaise:0,realizedPnlPaise:0,
  positions:{"NSE_EQ|AAA":{quantity:5,averagePricePaise:8000,costBasisPaise:40000}},
  reservedPositions:{"NSE_EQ|AAA":2},version:1
 });
 await orderRef.set({
  uid,instrumentKey:"NSE_EQ|AAA",side:"SELL",quantity:2,orderType:"LIMIT",
  limitPricePaise:10000,status:"PENDING",simulationOnly:true,
  reservedCashPaise:0,reservedQuantity:2
 });
 try{
  const results=await Promise.allSettled([
   cancelPendingLimitOrder({db,accountRef,orderRef,uid,serverTimestamp}),
   executePendingLimitOrderInWorker({db,orderRef,order:(await orderRef.get()).data(),quote,nowMs,serverTimestamp})
  ]);
  const [account,order]=await Promise.all([accountRef.get(),orderRef.get()]);
  const stored=order.data(),state=account.data();
  assert.ok(["CANCELLED","FILLED"].includes(stored.status));
  assert.equal(state.reservedPositions["NSE_EQ|AAA"],undefined);
  if(stored.status==="CANCELLED"){
   assert.equal(state.cashPaise,100000);
   assert.equal(state.positions["NSE_EQ|AAA"].quantity,5);
   assert.equal(state.positions["NSE_EQ|AAA"].costBasisPaise,40000);
   assert.equal(state.realizedPnlPaise,0);
   assert.ok(results.some(result=>result.status==="fulfilled"&&result.value?.status==="CANCELLED"));
  }else{
   assert.equal(state.cashPaise,121000);
   assert.equal(state.positions["NSE_EQ|AAA"].quantity,3);
   assert.equal(state.positions["NSE_EQ|AAA"].costBasisPaise,24000);
   assert.equal(state.realizedPnlPaise,5000);
   assert.equal(stored.realizedPnlPaise,5000);
   assert.ok(results.some(result=>result.status==="fulfilled"&&result.value==="FILLED"));
  }
 }finally{await clean([accountRef,orderRef]);}
});

integrationTest("Firestore emulator counts a closed legacy cash position as new at the 50-position LIMIT cap",async()=>{
 const id=crypto.randomUUID(),uid="limit-position-cap-"+id;
 const accountRef=db.collection("emulatorPaperAccounts").doc(uid);
 const orderRef=db.collection("emulatorPaperOrders").doc("limit-position-cap-"+id);
 const positions=Object.fromEntries(Array.from({length:50},(_,i)=>[
  `NSE_EQ|OPEN${i}`,{quantity:1,averagePricePaise:100,costBasisPaise:100}
 ]));
 positions["NSE_EQ|CLOSED"]={quantity:0,averagePricePaise:0,costBasisPaise:0};
 await accountRef.set({cashPaise:100000,reservedCashPaise:0,reservedMarginPaise:0,realizedPnlPaise:0,positions,reservedPositions:{},version:1});
 try{
  await assert.rejects(placePendingLimitOrder({
   db,accountRef,orderRef,uid,
   order:{uid,instrumentKey:"NSE_EQ|CLOSED",tradingSymbol:"CLOSED",exchange:"NSE",side:"BUY",quantity:1,orderType:"LIMIT",limitPricePaise:100,status:"PENDING",simulationOnly:true},
   serverTimestamp:()=>FieldValue.serverTimestamp()
  }),error=>error.status===409&&/50 open positions/.test(error.message));
  const [account,order]=await Promise.all([accountRef.get(),orderRef.get()]);
  assert.equal(account.data().reservedCashPaise,0);
  assert.equal(order.exists,false);
 }finally{await clean([accountRef,orderRef]);}
});

integrationTest("Firestore emulator rejects explicitly null account maps when placing LIMIT orders",async()=>{
 for(const field of ["positions","reservedPositions"]){
  const uid="limit-null-map-"+field+"-"+crypto.randomUUID();
  const accountRef=db.collection("emulatorPaperAccounts").doc(uid);
  const orderRef=db.collection("emulatorPaperOrders").doc(crypto.randomUUID());
  const account={cashPaise:100000,reservedCashPaise:0,reservedMarginPaise:0,realizedPnlPaise:0,positions:{},reservedPositions:{},version:1};
  account[field]=null;
  await accountRef.set(account);
  try{
   await assert.rejects(placePendingLimitOrder({
    db,accountRef,orderRef,uid,
    order:{uid,requestFingerprint:crypto.randomUUID(),instrumentKey:"NSE_EQ|AAA",tradingSymbol:"AAA",exchange:"NSE",side:"BUY",quantity:1,orderType:"LIMIT",limitPricePaise:10000,status:"PENDING",simulationOnly:true},
    serverTimestamp:()=>FieldValue.serverTimestamp()
   }),/Paper account reservation state is invalid/);
   const [storedAccount,storedOrder]=await Promise.all([accountRef.get(),orderRef.get()]);
   assert.equal(storedAccount.data()[field],null);
   assert.equal(storedAccount.data().reservedCashPaise,0);
   assert.equal(storedOrder.exists,false);
  }finally{await clean([accountRef,orderRef]);}
 }
});

integrationTest("Firestore emulator rejects malformed unrelated positions before reserving a LIMIT order",async()=>{
 const uid="limit-bad-position-"+crypto.randomUUID();
 const accountRef=db.collection("emulatorPaperAccounts").doc(uid);
 const orderRef=db.collection("emulatorPaperOrders").doc(crypto.randomUUID());
 await accountRef.set({
  cashPaise:100000,reservedCashPaise:0,reservedMarginPaise:0,realizedPnlPaise:0,
  positions:{"NSE_EQ|BROKEN":{quantity:2,averagePricePaise:0,costBasisPaise:0}},
  reservedPositions:{},version:1
 });
 try{
  await assert.rejects(placePendingLimitOrder({
   db,accountRef,orderRef,uid,
   order:{uid,requestFingerprint:crypto.randomUUID(),instrumentKey:"NSE_EQ|AAA",tradingSymbol:"AAA",exchange:"NSE",side:"BUY",quantity:1,orderType:"LIMIT",limitPricePaise:10000,status:"PENDING",simulationOnly:true},
   serverTimestamp:()=>FieldValue.serverTimestamp()
  }),/malformed cash-equity position|invalid cash-equity cost basis/);
  const [storedAccount,storedOrder]=await Promise.all([accountRef.get(),orderRef.get()]);
  assert.equal(storedAccount.data().reservedCashPaise,0);
  assert.equal(storedOrder.exists,false);
 }finally{await clean([accountRef,orderRef]);}
});

integrationTest("Firestore emulator refuses to release mismatched LIMIT reservation metadata",async()=>{
 const cases=[
  {side:"BUY",quantity:2,limitPricePaise:10000,reservedCashPaise:10000,reservedQuantity:0,
   cashPaise:100000,reservedAccountCash:10000,positions:{},reservedPositions:{}},
  {side:"SELL",quantity:2,limitPricePaise:10000,reservedCashPaise:0,reservedQuantity:1,
   cashPaise:100000,reservedAccountCash:0,positions:{"NSE_EQ|AAA":{quantity:3,averagePricePaise:8000,costBasisPaise:24000}},reservedPositions:{"NSE_EQ|AAA":1}}
 ];
 for(const item of cases){
  const uid="limit-reservation-mismatch-"+crypto.randomUUID();
  const accountRef=db.collection("emulatorPaperAccounts").doc(uid);
  const orderRef=db.collection("emulatorPaperOrders").doc(crypto.randomUUID());
  await accountRef.set({
   cashPaise:item.cashPaise,reservedCashPaise:item.reservedAccountCash,reservedMarginPaise:0,
   realizedPnlPaise:0,positions:item.positions,reservedPositions:item.reservedPositions,version:1
  });
  await orderRef.set({
   uid,instrumentKey:"NSE_EQ|AAA",side:item.side,quantity:item.quantity,
   orderType:"LIMIT",limitPricePaise:item.limitPricePaise,status:"PENDING",simulationOnly:true,
   reservedCashPaise:item.reservedCashPaise,reservedQuantity:item.reservedQuantity
  });
  try{
   await assert.rejects(cancelPendingLimitOrder({db,accountRef,orderRef,uid,serverTimestamp:()=>FieldValue.serverTimestamp()}),/reservation is missing or inconsistent/);
   const [storedAccount,storedOrder]=await Promise.all([accountRef.get(),orderRef.get()]);
   assert.equal(storedAccount.data().reservedCashPaise,item.reservedAccountCash);
   assert.deepEqual(storedAccount.data().reservedPositions,item.reservedPositions);
   assert.equal(storedOrder.data().status,"PENDING");
  }finally{await clean([accountRef,orderRef]);}
 }
});


integrationTest("Firestore emulator refuses worker fills with mismatched LIMIT reservation metadata",async()=>{
 const cases=[
  {
   side:"BUY",quantity:2,limitPricePaise:10000,reservedCashPaise:10000,reservedQuantity:0,
   cashPaise:100000,reservedAccountCash:20000,
   positions:{},reservedPositions:{},
   expected:/LIMIT BUY cash reservation is inconsistent/
  },
  {
   side:"SELL",quantity:2,limitPricePaise:10000,reservedCashPaise:0,reservedQuantity:1,
   cashPaise:100000,reservedAccountCash:0,
   positions:{"NSE_EQ|AAA":{quantity:5,averagePricePaise:8000,costBasisPaise:40000}},
   reservedPositions:{"NSE_EQ|AAA":2},
   expected:/LIMIT SELL share reservation is inconsistent/
  }
 ];
 for(const item of cases){
  const uid="worker-limit-reservation-mismatch-"+crypto.randomUUID();
  const accountRef=db.collection("indianPaperAccounts").doc(uid);
  const orderRef=db.collection("emulatorPaperOrders").doc("worker-limit-"+crypto.randomUUID());
  const nowMs=Date.now(),quote={pricePaise:item.side==="BUY"?9500:10500,timestampMs:nowMs-500};
  await accountRef.set({
   cashPaise:item.cashPaise,reservedCashPaise:item.reservedAccountCash,reservedMarginPaise:0,
   realizedPnlPaise:0,positions:item.positions,reservedPositions:item.reservedPositions,version:1
  });
  await orderRef.set({
   uid,instrumentKey:"NSE_EQ|AAA",side:item.side,quantity:item.quantity,
   orderType:"LIMIT",limitPricePaise:item.limitPricePaise,status:"PENDING",simulationOnly:true,
   reservedCashPaise:item.reservedCashPaise,reservedQuantity:item.reservedQuantity
  });
  try{
   const before=(await accountRef.get()).data();
   const order=(await orderRef.get()).data();
   await assert.rejects(
    executePendingLimitOrderInWorker({db,orderRef,order,quote,nowMs,serverTimestamp:()=>FieldValue.serverTimestamp()}),
    item.expected
   );
   const [after,storedOrder]=await Promise.all([accountRef.get(),orderRef.get()]);
   assert.deepEqual(after.data(),before);
   assert.equal(storedOrder.data().status,"PENDING");
   assert.equal(storedOrder.data().reservationReleased,undefined);
  }finally{await clean([accountRef,orderRef]);}
 }
});


integrationTest("Firestore emulator serializes worker LIMIT execution against user cancellation",async()=>{
 const id=crypto.randomUUID(),uid="worker-limit-race-user-"+id;
 const accountRef=db.collection("indianPaperAccounts").doc(uid);
 const orderRef=db.collection("indianPaperOrders").doc("worker-limit-race-"+id);
 const serverTimestamp=()=>FieldValue.serverTimestamp();
 await accountRef.set({
  cashPaise:100000,reservedCashPaise:0,reservedMarginPaise:0,realizedPnlPaise:0,
  positions:{},reservedPositions:{},version:1
 });
 try{
  await placePendingLimitOrder({
   db,accountRef,orderRef,uid,
   order:{uid,instrumentKey:"NSE_EQ|AAA",tradingSymbol:"AAA",exchange:"NSE",side:"BUY",quantity:2,orderType:"LIMIT",limitPricePaise:10000,status:"PENDING",simulationOnly:true},
   serverTimestamp
  });
  const order=(await orderRef.get()).data();
  const nowMs=Date.now(),quote={pricePaise:9000,timestampMs:nowMs-500};
  const results=await Promise.allSettled([
   cancelPendingLimitOrder({db,accountRef,orderRef,uid,serverTimestamp}),
   executePendingLimitOrderInWorker({db,orderRef,order,quote,nowMs,serverTimestamp})
  ]);
  const [account,storedOrder]=await Promise.all([accountRef.get(),orderRef.get()]);
  const state=account.data(),stored=storedOrder.data();
  assert.ok(["CANCELLED","FILLED"].includes(stored.status));
  assert.equal(state.reservedCashPaise,0);
  if(stored.status==="CANCELLED"){
   assert.equal(state.cashPaise,100000);
   assert.equal(state.positions["NSE_EQ|AAA"],undefined);
   assert.ok(results[0].status==="fulfilled");
   assert.ok(
    (results[1].status==="fulfilled"&&results[1].value!=="FILLED")||
    (results[1].status==="rejected"&&[3,10].includes(results[1].reason?.code))
   );
  }else{
   assert.equal(state.cashPaise,82000);
   assert.equal(state.positions["NSE_EQ|AAA"].quantity,2);
   assert.ok(results[1].status==="fulfilled"&&results[1].value==="FILLED");
   assert.ok(results[0].status==="rejected"&&results[0].reason.status===409);
  }
 }finally{await clean([accountRef,orderRef]);}
});
