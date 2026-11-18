"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {executePaperOrderTransaction}=require("../lib/paper-order-transaction");
const account={cashPaise:10000,realizedPnlPaise:0,positions:{},version:1};
function setup(existingOrder,initialAccount=account){
 const writes=[];
 const snapshots={"user-1":{exists:true,data:()=>({...initialAccount,positions:{...initialAccount.positions}})},order:{exists:Boolean(existingOrder),data:()=>existingOrder}};
 const db={runTransaction:async callback=>callback({get:async ref=>snapshots[ref.id],create:(ref,data)=>writes.push(["create",ref.id,data]),update:(ref,data)=>writes.push(["update",ref.id,data])})};
 const common={db,accountRef:{id:"user-1"},orderRef:{id:"order"},uid:"user-1",requestFingerprint:"fingerprint",order:{uid:"user-1",requestFingerprint:"fingerprint",instrumentKey:"NSE_EQ|AAA",side:"BUY",quantity:2},pricePaise:1000,publicPaperOrder:(order,meta)=>({order,meta}),serverTimestamp:()=>"server-time"};
 return {common,writes};
}
test("shared transaction writes the order and account update atomically",async()=>{
 const {common,writes}=setup();
 const result=await executePaperOrderTransaction(common);
 assert.equal(writes.length,2);
 assert.equal(writes[0][0],"create");
 assert.equal(writes[0][2].grossPaise,2000);
 assert.equal(writes[1][0],"update");
 assert.equal(writes[1][2].cashPaise,8000);
 assert.equal(writes[1][2].version,2);
 assert.equal(result.meta.cashPaise,8000);
});
test("matching existing order is returned as an idempotent replay without writes",async()=>{
 const prior={requestFingerprint:"fingerprint",status:"FILLED"};
 const {common,writes}=setup(prior);
 const result=await executePaperOrderTransaction(common);
 assert.equal(writes.length,0);
 assert.equal(result.meta.idempotentReplay,true);
});
test("reusing an order key with a different request is rejected",async()=>{
 const prior={requestFingerprint:"different"};
 const {common,writes}=setup(prior);
 await assert.rejects(executePaperOrderTransaction(common),{status:409});
 assert.equal(writes.length,0);
});
test("missing account is rejected without writing an order",async()=>{
 const {common,writes}=setup();
 common.db.runTransaction=async callback=>callback({get:async ref=>ref.id==="user-1"?{exists:false}:{exists:false},create:(...args)=>writes.push(args),update:(...args)=>writes.push(args)});
 await assert.rejects(executePaperOrderTransaction(common),{status:409});
 assert.equal(writes.length,0);
});
function createSerializableStore(initialAccount){
 const state={account:{...initialAccount,positions:{...initialAccount.positions}},orders:new Map()};
 let tail=Promise.resolve();
 const db={runTransaction(callback){
   const run=tail.then(async()=>{
     const writes=[];
     const tx={
       get:async ref=>{
         if(ref.id==="user-1")return {exists:true,data:()=>({...state.account,positions:{...state.account.positions}})};
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
test("concurrent identical submissions create one fill and replay the same order",async()=>{
 const {db,state}=createSerializableStore(account);
 const common={db,accountRef:{id:"user-1"},orderRef:{id:"same-order"},uid:"user-1",requestFingerprint:"fingerprint",order:{uid:"user-1",requestFingerprint:"fingerprint",instrumentKey:"NSE_EQ|AAA",side:"BUY",quantity:2},pricePaise:1000,publicPaperOrder:(order,meta)=>({order,meta}),serverTimestamp:()=>"server-time"};
 const [a,b]=await Promise.all([executePaperOrderTransaction(common),executePaperOrderTransaction(common)]);
 assert.equal(state.orders.size,1);
 assert.equal(state.account.cashPaise,8000);
 assert.equal(state.account.positions["NSE_EQ|AAA"].quantity,2);
 assert.deepEqual([a.meta.idempotentReplay||false,b.meta.idempotentReplay||false].sort(),[false,true]);
});
test("concurrent different orders serialize against latest cash and cannot overspend",async()=>{
 const {db,state}=createSerializableStore({...account,cashPaise:10000});
 const make=key=>({db,accountRef:{id:"account"},orderRef:{id:key},uid:"user-1",requestFingerprint:key,order:{uid:"user-1",requestFingerprint:key,instrumentKey:"NSE_EQ|"+key,side:"BUY",quantity:1},pricePaise:7000,publicPaperOrder:(order,meta)=>({order,meta}),serverTimestamp:()=>"server-time"});
 const results=await Promise.allSettled([executePaperOrderTransaction(make("order-a")),executePaperOrderTransaction(make("order-b"))]);
 assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
 assert.equal(results.filter(x=>x.status==="rejected"&&x.reason.status===409).length,1);
 assert.equal(state.orders.size,1);
 assert.equal(state.account.cashPaise,3000);
 assert.equal(state.account.version,2);
});

test("rejects a transaction whose order belongs to another user",async()=>{
 const {common,writes}=setup();
 common.order.uid="different-user";
 await assert.rejects(executePaperOrderTransaction(common),TypeError);
 assert.equal(writes.length,0);
});
test("rejects a transaction fingerprint that differs from the stored order",async()=>{
 const {common,writes}=setup();
 common.order.requestFingerprint="different";
 await assert.rejects(executePaperOrderTransaction(common),TypeError);
 assert.equal(writes.length,0);
});

test("SELL transaction credits proceeds and records realized P&L atomically",async()=>{
 const initial={cashPaise:10000,realizedPnlPaise:0,positions:{"NSE_EQ|AAA":{quantity:2,averagePricePaise:1000}},version:4};
 const {common,writes}=setup(undefined,initial);
 common.order.side="SELL";common.order.quantity=1;common.pricePaise=1200;
 const result=await executePaperOrderTransaction(common);
 assert.equal(writes.length,2);
 assert.equal(writes[0][2].grossPaise,1200);
 assert.equal(writes[0][2].realizedPnlPaise,200);
 assert.equal(writes[1][2].cashPaise,11200);
 assert.equal(writes[1][2].realizedPnlPaise,200);
 assert.equal(writes[1][2].positions["NSE_EQ|AAA"].quantity,1);
 assert.equal(writes[1][2].version,5);
 assert.equal(result.meta.cashPaise,11200);
});
test("insufficient virtual cash rejects transaction before any database write",async()=>{
 const {common,writes}=setup();
 common.order.quantity=2;common.pricePaise=6000;
 await assert.rejects(executePaperOrderTransaction(common),{status:409});
 assert.equal(writes.length,0);
});
test("SELL beyond available holdings rejects transaction before any database write",async()=>{
 const initial={cashPaise:10000,realizedPnlPaise:0,positions:{"NSE_EQ|AAA":{quantity:1,averagePricePaise:1000}},version:2};
 const {common,writes}=setup(undefined,initial);
 common.order.side="SELL";common.order.quantity=2;
 await assert.rejects(executePaperOrderTransaction(common),{status:409});
 assert.equal(writes.length,0);
});

test("closing the full position removes its instrument entry",async()=>{
 const initial={cashPaise:10000,realizedPnlPaise:0,positions:{"NSE_EQ|AAA":{quantity:2,averagePricePaise:1000}},version:7};
 const {common,writes}=setup(undefined,initial);
 common.order.side="SELL";common.order.quantity=2;common.pricePaise=1100;
 await executePaperOrderTransaction(common);
 assert.equal(Object.hasOwn(writes[1][2].positions,"NSE_EQ|AAA"),false);
 assert.equal(writes[1][2].cashPaise,12200);
 assert.equal(writes[1][2].realizedPnlPaise,200);
});
test("replayed order reports the current account balance without applying a second fill",async()=>{
 const prior={requestFingerprint:"fingerprint",status:"FILLED",grossPaise:2000};
 const {common,writes}=setup(prior,{cashPaise:6500,realizedPnlPaise:250,positions:{},version:3});
 const result=await executePaperOrderTransaction(common);
 assert.equal(writes.length,0);
 assert.equal(result.meta.cashPaise,6500);
 assert.equal(result.meta.realizedPnlTotalPaise,250);
 assert.equal(result.meta.idempotentReplay,true);
});
