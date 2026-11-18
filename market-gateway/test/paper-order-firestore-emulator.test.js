"use strict";
const crypto=require("node:crypto");
const test=require("node:test");
const assert=require("node:assert/strict");
const {Firestore,FieldValue}=require("@google-cloud/firestore");
const {executePaperOrderTransaction}=require("../lib/paper-order-transaction");

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
 const common=makeOrder({uid,accountId:"acct-"+id,orderId:"order-"+id,fingerprint:"same-fingerprint"});
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
 const first=makeOrder({uid,accountId,orderId:"order-a-"+id,fingerprint:"fingerprint-a",instrumentKey:"NSE_EQ|AAA",pricePaise:7000});
 const second=makeOrder({uid,accountId,orderId:"order-b-"+id,fingerprint:"fingerprint-b",instrumentKey:"NSE_EQ|BBB",pricePaise:7000});
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
 const a=makeOrder({uid:"user-a-"+id,accountId:"account-a-"+id,orderId:"order-a-"+id,fingerprint:"fingerprint-a",pricePaise:2500});
 const b=makeOrder({uid:"user-b-"+id,accountId:"account-b-"+id,orderId:"order-b-"+id,fingerprint:"fingerprint-b",pricePaise:4000});
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

