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
