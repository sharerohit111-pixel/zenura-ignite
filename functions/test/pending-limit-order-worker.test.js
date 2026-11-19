"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {processPendingLimitOrders}=require("../lib/pending-limit-order-worker");

function harness(order,account){
 const records=new Map([["indianPaperOrders/order-1",structuredClone(order)],["indianPaperAccounts/user-1",structuredClone(account)]]);
 const ref=path=>({id:path.split("/").at(-1),path});
 const orderRef=ref("indianPaperOrders/order-1");
 const db={
  collection(name){
   if(name==="indianPaperAccounts")return {doc:uid=>ref(name+"/"+uid)};
   let query={where(){return this;},orderBy(){return this;},limit(){return this;},get:async()=>{
    const docs=[];
    for(const [path,value] of records)if(path.startsWith("indianPaperOrders/")&&value.status==="PENDING"&&value.orderType==="LIMIT")docs.push({id:path.split("/").at(-1),ref:ref(path),data:()=>structuredClone(value)});
    return {docs,size:docs.length};
   }};
   return query;
  },
  runTransaction:async callback=>{
   const writes=[];
   const tx={get:async r=>{const value=records.get(r.path);return {exists:value!==undefined,data:()=>structuredClone(value)};},
    update:(r,patch)=>writes.push([r.path,structuredClone(patch)])};
   const result=await callback(tx);
   for(const [path,patch] of writes)records.set(path,{...records.get(path),...patch});
   return result;
  }
 };
 return {db,records,orderRef};
}
const now=Date.parse("2026-11-20T05:00:00Z");
const stamp=()=>new Date(now);
const baseOrder={uid:"user-1",instrumentKey:"NSE_EQ|ABC",side:"BUY",quantity:2,orderType:"LIMIT",limitPricePaise:10000,status:"PENDING",simulationOnly:true,reservedCashPaise:20000,reservedQuantity:0};
const baseAccount={cashPaise:100000,realizedPnlPaise:0,positions:{},reservedCashPaise:20000,reservedMarginPaise:0,reservedPositions:{},version:1};

test("scheduled worker fills eligible fresh BUY limit order atomically",async()=>{
 const h=harness(baseOrder,baseAccount),oldNow=Date.now;Date.now=()=>now;
 try{
  const summary=await processPendingLimitOrders({db:h.db,fetchQuote:async()=>({pricePaise:9500,timestampMs:now-1000}),nowMs:now,serverTimestamp:stamp});
  assert.deepEqual(summary,{scanned:1,filled:1,notEligible:0,failed:0,alreadyFilled:0});
  assert.equal(h.records.get("indianPaperOrders/order-1").status,"FILLED");
  assert.equal(h.records.get("indianPaperAccounts/user-1").cashPaise,81000);
  assert.equal(h.records.get("indianPaperAccounts/user-1").reservedCashPaise,0);
  assert.equal(h.records.get("indianPaperAccounts/user-1").positions["NSE_EQ|ABC"].quantity,2);
 }finally{Date.now=oldNow;}
});

test("worker never fills stale or limit-unreached quotes",async()=>{
 const h=harness(baseOrder,baseAccount),oldNow=Date.now;Date.now=()=>now;
 try{
  const summary=await processPendingLimitOrders({db:h.db,fetchQuote:async()=>({pricePaise:10001,timestampMs:now-16000}),nowMs:now,serverTimestamp:stamp});
  assert.equal(summary.filled,0);
  assert.equal(h.records.get("indianPaperOrders/order-1").status,"PENDING");
  assert.equal(h.records.get("indianPaperAccounts/user-1").reservedCashPaise,20000);
 }finally{Date.now=oldNow;}
});

test("worker isolates a failed quote provider request and continues the batch",async()=>{
 const h=harness(baseOrder,baseAccount),warnings=[];
 const summary=await processPendingLimitOrders({db:h.db,fetchQuote:async()=>{throw new Error("provider offline");},nowMs:now,serverTimestamp:stamp,logger:{warn:(...args)=>warnings.push(args)}});
 assert.equal(summary.failed,1);
 assert.equal(warnings.length,1);
 assert.equal(h.records.get("indianPaperOrders/order-1").status,"PENDING");
});

test("worker does not execute orders outside pending paper LIMIT state",async()=>{
 const h=harness({...baseOrder,status:"CANCELLED"},baseAccount);
 const summary=await processPendingLimitOrders({db:h.db,fetchQuote:async()=>{throw new Error("must not fetch");},nowMs:now,serverTimestamp:stamp});
 assert.equal(summary.scanned,0);
 assert.equal(summary.filled,0);
});
