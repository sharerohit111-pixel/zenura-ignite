"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {processPendingLimitOrders}=require("../lib/pending-limit-order-worker");

function harness(order,account,extraOrders=[]){
 const records=new Map([["indianPaperOrders/order-1",structuredClone(order)],["indianPaperAccounts/user-1",structuredClone(account)]]);
 for(const item of extraOrders)records.set("indianPaperOrders/"+item.id,structuredClone(item.order));
 const ref=path=>({id:path.split("/").at(-1),path});
 const orderRef=ref("indianPaperOrders/order-1");
 const db={
  collection(name){
   if(name==="indianPaperAccounts")return {doc:uid=>ref(name+"/"+uid)};
   if(name==="indianMarketWorkerState")return {doc:id=>{
    const stateRef=ref(name+"/"+id);
    return {...stateRef,get:async()=>{const value=records.get(stateRef.path);return {exists:value!==undefined,data:()=>structuredClone(value)};},
      set:async(value)=>records.set(stateRef.path,{...(records.get(stateRef.path)||{}),...structuredClone(value)})};
   }};
   const collectionRef={doc:id=>{
    const orderDocRef=ref(name+"/"+id);
    return {...orderDocRef,get:async()=>{const value=records.get(orderDocRef.path);return {exists:value!==undefined,data:()=>structuredClone(value)};}};
   }};
   let afterId=null,limitValue=50;
   let query={where(){return this;},orderBy(){return this;},startAfter(snapshot){afterId=snapshot.id;return this;},limit(value){limitValue=value;return this;},get:async()=>{
    const docs=[];
    for(const [path,value] of records)if(path.startsWith("indianPaperOrders/")&&value.status==="PENDING"&&value.orderType==="LIMIT"){
      const id=path.split("/").at(-1);
      if(!afterId||id>afterId)docs.push({id,ref:ref(path),data:()=>structuredClone(value)});
    }
    docs.sort((a,b)=>a.id.localeCompare(b.id));
    const page=docs.slice(0,limitValue);
    return {docs:page,size:page.length,empty:page.length===0};
   }};
   return Object.assign(collectionRef,query);
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
const baseOrder={uid:"user-1",createdAt:new Date(now),instrumentKey:"NSE_EQ|ABC",side:"BUY",quantity:2,orderType:"LIMIT",limitPricePaise:10000,status:"PENDING",simulationOnly:true,reservedCashPaise:20000,reservedQuantity:0};
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

test("worker rotates its cursor so older blocked orders cannot starve later orders",async()=>{
 const second={...baseOrder,instrumentKey:"NSE_EQ|XYZ",reservedCashPaise:20000};
 const account={...baseAccount,reservedCashPaise:40000};
 const h=harness(baseOrder,account,[{id:"order-2",order:second}]),oldNow=Date.now;Date.now=()=>now;
 try{
  const fetchQuote=async order=>({pricePaise:9500,timestampMs:now-1000});
  const first=await processPendingLimitOrders({db:h.db,fetchQuote,nowMs:now,serverTimestamp:stamp,maxOrders:1});
  assert.equal(first.filled,1);
  assert.equal(h.records.get("indianMarketWorkerState/pendingLimitOrders").cursorOrderId,"order-1");
  const secondRun=await processPendingLimitOrders({db:h.db,fetchQuote,nowMs:now,serverTimestamp:stamp,maxOrders:1});
  assert.equal(secondRun.filled,1);
  assert.equal(h.records.get("indianPaperOrders/order-2").status,"FILLED");
 }finally{Date.now=oldNow;}
});
