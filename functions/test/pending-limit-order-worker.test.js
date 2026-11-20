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
    return {...orderDocRef,get:async()=>{const value=records.get(orderDocRef.path);return {id:orderDocRef.id,exists:value!==undefined,data:()=>structuredClone(value)};}};
   }};
   const makeQuery=(afterId=null,limitValue=50)=>({
    where(){return this;},orderBy(){return this;},
    startAfter(snapshot){return makeQuery(snapshot.id,limitValue);},
    limit(value){return makeQuery(afterId,value);},
    get:async()=>{
     const docs=[];
     for(const [path,value] of records)if(path.startsWith("indianPaperOrders/")&&value.status==="PENDING"&&value.orderType==="LIMIT"){
       const id=path.split("/").at(-1);
       if(!afterId||id>afterId)docs.push({id,ref:ref(path),data:()=>structuredClone(value)});
     }
     docs.sort((a,b)=>a.id.localeCompare(b.id));
     const page=docs.slice(0,limitValue);
     return {docs:page,size:page.length,empty:page.length===0};
    }
   });
   return Object.assign(collectionRef,makeQuery());
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

test("worker accepts a fresh quote timestamped after the scan began",async()=>{
 const h=harness(baseOrder,baseAccount),oldNow=Date.now;
 try{
  const summary=await processPendingLimitOrders({
   db:h.db,
   fetchQuote:async()=>{
    Date.now=()=>now+1000;
    return {pricePaise:9500,timestampMs:now+500};
   },
   nowMs:now,serverTimestamp:stamp
  });
  assert.equal(summary.filled,1);
  assert.equal(summary.notEligible,0);
  assert.equal(h.records.get("indianPaperOrders/order-1").status,"FILLED");
  assert.equal(h.records.get("indianPaperAccounts/user-1").reservedCashPaise,0);
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

test("failed quote request is retried after cursor wrap without releasing its reservation",async()=>{
 const h=harness(baseOrder,baseAccount),oldNow=Date.now;Date.now=()=>now;
 try{
  const failed=await processPendingLimitOrders({db:h.db,fetchQuote:async()=>{throw new Error("temporary provider outage");},nowMs:now,serverTimestamp:stamp,maxOrders:1});
  assert.equal(failed.failed,1);
  assert.equal(h.records.get("indianPaperOrders/order-1").status,"PENDING");
  assert.equal(h.records.get("indianPaperAccounts/user-1").reservedCashPaise,20000);
  assert.equal(h.records.get("indianMarketWorkerState/pendingLimitOrders").cursorOrderId,"order-1");
  const recovered=await processPendingLimitOrders({db:h.db,fetchQuote:async()=>({pricePaise:9500,timestampMs:now-500}),nowMs:now,serverTimestamp:stamp,maxOrders:1});
  assert.equal(recovered.filled,1);
  assert.equal(h.records.get("indianPaperOrders/order-1").status,"FILLED");
  assert.equal(h.records.get("indianPaperAccounts/user-1").reservedCashPaise,0);
  assert.equal(h.records.get("indianPaperAccounts/user-1").positions["NSE_EQ|ABC"].quantity,2);
 }finally{Date.now=oldNow;}
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


test("scheduled worker fills eligible fresh SELL limit order and releases reserved shares",async()=>{
 const sellOrder={...baseOrder,side:"SELL",reservedCashPaise:0,reservedQuantity:2};
 const sellAccount={...baseAccount,cashPaise:100000,positions:{"NSE_EQ|ABC":{quantity:3,averagePricePaise:8000,costBasisPaise:24000}},reservedCashPaise:0,reservedPositions:{"NSE_EQ|ABC":2}};
 const h=harness(sellOrder,sellAccount),oldNow=Date.now;Date.now=()=>now;
 try{
  const summary=await processPendingLimitOrders({db:h.db,fetchQuote:async()=>({pricePaise:11000,timestampMs:now-500}),nowMs:now,serverTimestamp:stamp});
  assert.equal(summary.filled,1);
  const account=h.records.get("indianPaperAccounts/user-1");
  assert.equal(account.cashPaise,122000);
  assert.equal(account.realizedPnlPaise,6000);
  assert.equal(account.positions["NSE_EQ|ABC"].quantity,1);
  assert.equal(account.reservedPositions["NSE_EQ|ABC"],undefined);
  assert.equal(h.records.get("indianPaperOrders/order-1").status,"FILLED");
 }finally{Date.now=oldNow;}
});

test("worker rejects inconsistent reserved share state without filling a SELL order",async()=>{
 const sellOrder={...baseOrder,side:"SELL",reservedCashPaise:0,reservedQuantity:2};
 const invalidAccount={...baseAccount,cashPaise:100000,positions:{"NSE_EQ|ABC":{quantity:3,averagePricePaise:8000,costBasisPaise:24000}},reservedCashPaise:0,reservedPositions:{"NSE_EQ|ABC":"2"}};
 const h=harness(sellOrder,invalidAccount),oldNow=Date.now;Date.now=()=>now;
 try{
  const summary=await processPendingLimitOrders({db:h.db,fetchQuote:async()=>({pricePaise:11000,timestampMs:now-500}),nowMs:now,serverTimestamp:stamp});
  assert.equal(summary.filled,0);
  assert.equal(summary.failed,1);
  assert.equal(h.records.get("indianPaperOrders/order-1").status,"PENDING");
  assert.equal(h.records.get("indianPaperAccounts/user-1").reservedPositions["NSE_EQ|ABC"],"2");
  assert.equal(h.records.get("indianPaperAccounts/user-1").positions["NSE_EQ|ABC"].quantity,3);
 }finally{Date.now=oldNow;}
});

test("worker refuses to apply a quote after the order instrument changes",async()=>{
 const h=harness(baseOrder,baseAccount),oldNow=Date.now;Date.now=()=>now;
 try{
  const summary=await processPendingLimitOrders({db:h.db,fetchQuote:async()=>{
   h.records.set("indianPaperOrders/order-1",{...baseOrder,instrumentKey:"NSE_EQ|XYZ"});
   return {pricePaise:9500,timestampMs:now-500};
  },nowMs:now,serverTimestamp:stamp});
  assert.equal(summary.filled,0);
  assert.equal(summary.notEligible,1);
  assert.equal(h.records.get("indianPaperOrders/order-1").status,"PENDING");
  assert.equal(h.records.get("indianPaperAccounts/user-1").reservedCashPaise,20000);
 }finally{Date.now=oldNow;}
});

test("worker refuses to apply a quote after the order side or limit changes",async()=>{
 const h=harness(baseOrder,baseAccount),oldNow=Date.now;Date.now=()=>now;
 try{
  const summary=await processPendingLimitOrders({db:h.db,fetchQuote:async()=>{
   h.records.set("indianPaperOrders/order-1",{...baseOrder,side:"SELL",limitPricePaise:9000});
   return {pricePaise:9500,timestampMs:now-500};
  },nowMs:now,serverTimestamp:stamp});
  assert.equal(summary.filled,0);
  assert.equal(summary.notEligible,1);
  assert.equal(h.records.get("indianPaperOrders/order-1").status,"PENDING");
  assert.equal(h.records.get("indianPaperAccounts/user-1").reservedCashPaise,20000);
 }finally{Date.now=oldNow;}
});

test("worker rejects future-dated quotes without releasing reservations",async()=>{
 const h=harness(baseOrder,baseAccount),oldNow=Date.now;Date.now=()=>now;
 try{
  const summary=await processPendingLimitOrders({db:h.db,fetchQuote:async()=>({pricePaise:9500,timestampMs:now+1}),nowMs:now,serverTimestamp:stamp});
  assert.equal(summary.filled,0);
  assert.equal(summary.notEligible,1);
  assert.equal(h.records.get("indianPaperOrders/order-1").status,"PENDING");
  assert.equal(h.records.get("indianPaperAccounts/user-1").reservedCashPaise,20000);
 }finally{Date.now=oldNow;}
});

test("worker rejects malformed unrelated positions before filling a LIMIT order",async()=>{
 const invalidAccount={...baseAccount,positions:{
  "NSE_EQ|ABC":{quantity:0,averagePricePaise:0,costBasisPaise:0},
  "NSE_EQ|BROKEN":{quantity:2,averagePricePaise:0,costBasisPaise:0}
 }};
 const h=harness(baseOrder,invalidAccount),oldNow=Date.now;Date.now=()=>now;
 try{
  const summary=await processPendingLimitOrders({db:h.db,fetchQuote:async()=>({pricePaise:9500,timestampMs:now-500}),nowMs:now,serverTimestamp:stamp});
  assert.equal(summary.filled,0);
  assert.equal(summary.failed,1);
  assert.equal(h.records.get("indianPaperOrders/order-1").status,"PENDING");
  assert.equal(h.records.get("indianPaperAccounts/user-1").cashPaise,100000);
  assert.equal(h.records.get("indianPaperAccounts/user-1").reservedCashPaise,20000);
 }finally{Date.now=oldNow;}
});

for(const field of ["positions","reservedPositions"]){
 test(`worker rejects an explicitly null account ${field} map`,async()=>{
  const invalidAccount={...baseAccount,[field]:null};
  const h=harness(baseOrder,invalidAccount),oldNow=Date.now;Date.now=()=>now;
  try{
   const summary=await processPendingLimitOrders({db:h.db,fetchQuote:async()=>({pricePaise:9500,timestampMs:now-500}),nowMs:now,serverTimestamp:stamp});
   assert.equal(summary.filled,0);
   assert.equal(summary.failed,1);
   assert.equal(h.records.get("indianPaperOrders/order-1").status,"PENDING");
   assert.equal(h.records.get("indianPaperAccounts/user-1")[field],null);
   assert.equal(h.records.get("indianPaperAccounts/user-1").reservedCashPaise,20000);
  }finally{Date.now=oldNow;}
 });
}

test("worker counts a closed legacy entry as a new position at the 50-position limit",async()=>{
 const positions=Object.fromEntries(Array.from({length:50},(_,i)=>[
  `NSE_EQ|OPEN${i}`,{quantity:1,averagePricePaise:1000,costBasisPaise:1000}
 ]));
 positions["NSE_EQ|CLOSED"]={quantity:0,averagePricePaise:0,costBasisPaise:0};
 const h=harness(baseOrder,{...baseAccount,positions}),oldNow=Date.now;Date.now=()=>now;
 try{
  const summary=await processPendingLimitOrders({db:h.db,fetchQuote:async()=>({pricePaise:9500,timestampMs:now-500}),nowMs:now,serverTimestamp:stamp});
  assert.equal(summary.filled,0);
  assert.equal(summary.failed,1);
  assert.equal(h.records.get("indianPaperOrders/order-1").status,"PENDING");
  assert.equal(h.records.get("indianPaperAccounts/user-1").positions["NSE_EQ|CLOSED"].quantity,0);
 }finally{Date.now=oldNow;}
});


for(const scenario of [
 {name:"BUY reservation below exact limit value",order:{reservedCashPaise:19999},account:{...baseAccount}},
 {name:"BUY order with unexpected reserved shares",order:{reservedQuantity:1},account:{...baseAccount}},
 {name:"SELL order with unexpected cash reservation",order:{side:"SELL",reservedCashPaise:1,reservedQuantity:2},account:{...baseAccount,cashPaise:100000,positions:{"NSE_EQ|ABC":{quantity:3,averagePricePaise:8000,costBasisPaise:24000}},reservedCashPaise:0,reservedPositions:{"NSE_EQ|ABC":2}}}
]){
 test(`worker rejects ${scenario.name}`,async()=>{
  const order={...baseOrder,...scenario.order};
  const h=harness(order,scenario.account),oldNow=Date.now;Date.now=()=>now;
  try{
   const summary=await processPendingLimitOrders({db:h.db,fetchQuote:async()=>({pricePaise:order.side==="SELL"?11000:9500,timestampMs:now-500}),nowMs:now,serverTimestamp:stamp});
   assert.equal(summary.filled,0);
   assert.equal(summary.failed,1);
   assert.equal(h.records.get("indianPaperOrders/order-1").status,"PENDING");
   assert.equal(h.records.get("indianPaperAccounts/user-1").reservedCashPaise,scenario.account.reservedCashPaise);
  }finally{Date.now=oldNow;}
 });
}

test("worker resets provisional FILLED outcome when Firestore retries after cancellation",async()=>{
 const h=harness(baseOrder,baseAccount),oldNow=Date.now;
 Date.now=()=>now;
 const orderPath="indianPaperOrders/order-1",accountPath="indianPaperAccounts/user-1";
 h.db.runTransaction=async callback=>{
  const invoke=async()=>{
   const writes=[];
   const tx={
    get:async ref=>{
     const value=h.records.get(ref.path);
     return {exists:value!==undefined,data:()=>structuredClone(value)};
    },
    update:(ref,patch)=>writes.push([ref.path,structuredClone(patch)])
   };
   await callback(tx);
   return writes;
  };
  await invoke();
  h.records.set(orderPath,{...h.records.get(orderPath),status:"CANCELLED",reservationReleased:true});
  h.records.set(accountPath,{...h.records.get(accountPath),reservedCashPaise:0});
  const retryWrites=await invoke();
  for(const [path,patch] of retryWrites)h.records.set(path,{...h.records.get(path),...patch});
 };
 try{
  const summary=await processPendingLimitOrders({
   db:h.db,
   fetchQuote:async()=>({pricePaise:9500,timestampMs:now-500}),
   nowMs:now,
   serverTimestamp:stamp
  });
  assert.deepEqual(summary,{scanned:1,filled:0,notEligible:1,failed:0,alreadyFilled:0});
  assert.equal(h.records.get(orderPath).status,"CANCELLED");
  assert.equal(h.records.get(accountPath).cashPaise,100000);
  assert.equal(h.records.get(accountPath).reservedCashPaise,0);
  assert.equal(h.records.get(accountPath).positions["NSE_EQ|ABC"],undefined);
 }finally{Date.now=oldNow;}
});
