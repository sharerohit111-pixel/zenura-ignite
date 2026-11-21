"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {placePendingLimitOrder,cancelPendingLimitOrder,executePendingLimitOrder}=require("../lib/pending-limit-order-transaction");

function harness(account,order){
 const records=new Map();
 records.set("accounts/user-1",structuredClone(account));
 if(order)records.set("orders/order-1",structuredClone(order));
 const ref=path=>({id:path.split("/").at(-1),path});
 let transactionTail=Promise.resolve();
 const db={runTransaction:callback=>{
  const run=transactionTail.then(async()=>{
   const writes=[];
   const tx={
    get:async r=>{const value=records.get(r.path);return {exists:value!==undefined,data:()=>structuredClone(value)};},
    create:(r,value)=>writes.push(["create",r.path,structuredClone(value)]),
    update:(r,value)=>writes.push(["update",r.path,structuredClone(value)])
   };
   const result=await callback(tx);
   for(const [kind,path,value] of writes){
    if(kind==="create"){if(records.has(path))throw new Error("already exists");records.set(path,value);}
    else records.set(path,{...records.get(path),...value});
   }
   return result;
  });
  transactionTail=run.catch(()=>{});
  return run;
 }};
 return {db,accountRef:ref("accounts/user-1"),orderRef:ref("orders/order-1"),records};
}
const stamp=()=>new Date("2026-11-20T10:00:00Z");
const baseOrder=(side="BUY",patch={})=>({uid:"user-1",instrumentKey:"NSE_EQ|ABC",tradingSymbol:"ABC",exchange:"NSE",side,quantity:3,orderType:"LIMIT",limitPricePaise:10000,status:"PENDING",simulationOnly:true,...patch});
const baseAccount=(patch={})=>({cashPaise:100000,realizedPnlPaise:0,positions:{},reservedCashPaise:0,reservedMarginPaise:0,reservedPositions:{},version:1,...patch});

test("same LIMIT idempotency key replays the committed order without reserving twice",async()=>{
 const fingerprint="limit-buy-abc-3-10000";
 const order=baseOrder("BUY",{requestFingerprint:fingerprint});
 const h=harness(baseAccount(),null);
 const args={db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",order,serverTimestamp:stamp};
 const first=await placePendingLimitOrder(args);
 assert.equal(first.status,"PENDING");
 assert.equal(first.idempotentReplay,undefined);
 const replay=await placePendingLimitOrder(args);
 assert.equal(replay.idempotentReplay,true);
 assert.equal(replay.orderId,first.orderId);
 assert.equal(h.records.get("accounts/user-1").reservedCashPaise,30000);
 assert.equal(h.records.get("accounts/user-1").version,2);
});

test("LIMIT idempotency key cannot replay a different order payload",async()=>{
 const h=harness(baseAccount(),null);
 const first=baseOrder("BUY",{requestFingerprint:"fingerprint-one"});
 await placePendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",order:first,serverTimestamp:stamp});
 const changed=baseOrder("BUY",{quantity:4,requestFingerprint:"fingerprint-two"});
 await assert.rejects(placePendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",order:changed,serverTimestamp:stamp}),{status:409});
 assert.equal(h.records.get("accounts/user-1").reservedCashPaise,30000);
 assert.equal(h.records.get("accounts/user-1").version,2);
});

test("LIMIT BUY reserves virtual cash atomically and rejects overspending",async()=>{
 const h=harness(baseAccount(),null);
 const result=await placePendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",order:baseOrder(),serverTimestamp:stamp});
 assert.equal(result.status,"PENDING");
 assert.equal(h.records.get("accounts/user-1").reservedCashPaise,30000);
 assert.equal(h.records.get("accounts/user-1").cashPaise,100000);
 assert.equal(h.records.get("orders/order-1").reservedCashPaise,30000);
 const low=harness(baseAccount({cashPaise:29999}),null);
 await assert.rejects(placePendingLimitOrder({db:low.db,accountRef:low.accountRef,orderRef:low.orderRef,uid:"user-1",order:baseOrder(),serverTimestamp:stamp}),{status:409});
 assert.equal(low.records.has("orders/order-1"),false);
});

test("LIMIT SELL reserves only unreserved shares",async()=>{
 const account=baseAccount({positions:{"NSE_EQ|ABC":{quantity:5,averagePricePaise:9000,costBasisPaise:45000}},reservedPositions:{"NSE_EQ|ABC":2}});
 const h=harness(account,null);
 await placePendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",order:baseOrder("SELL"),serverTimestamp:stamp});
 assert.equal(h.records.get("accounts/user-1").reservedPositions["NSE_EQ|ABC"],5);
 const short=harness(account,null);
 await assert.rejects(placePendingLimitOrder({db:short.db,accountRef:short.accountRef,orderRef:short.orderRef,uid:"user-1",order:baseOrder("SELL",{quantity:4}),serverTimestamp:stamp}),{status:409});
});

test("cancellation releases BUY cash reservation exactly once",async()=>{
 const order=baseOrder("BUY",{reservedCashPaise:30000,reservedQuantity:0});
 const h=harness(baseAccount({reservedCashPaise:30000}),order);
 const result=await cancelPendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",serverTimestamp:stamp});
 assert.equal(result.reservationReleased,true);
 assert.equal(h.records.get("accounts/user-1").reservedCashPaise,0);
 const replay=await cancelPendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",serverTimestamp:stamp});
 assert.equal(replay.idempotentReplay,true);
 assert.equal(h.records.get("accounts/user-1").reservedCashPaise,0);
});

test("cancellation releases SELL shares without changing the holding",async()=>{
 const order=baseOrder("SELL",{reservedCashPaise:0,reservedQuantity:3});
 const account=baseAccount({positions:{"NSE_EQ|ABC":{quantity:5,averagePricePaise:9000,costBasisPaise:45000}},reservedPositions:{"NSE_EQ|ABC":3}});
 const h=harness(account,order);
 await cancelPendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",serverTimestamp:stamp});
 assert.equal(h.records.get("accounts/user-1").reservedPositions["NSE_EQ|ABC"],undefined);
 assert.equal(h.records.get("accounts/user-1").positions["NSE_EQ|ABC"].quantity,5);
});

test("fresh eligible BUY executes once and releases unused cash",async()=>{
 const order=baseOrder("BUY",{reservedCashPaise:30000,reservedQuantity:0});
 const h=harness(baseAccount({reservedCashPaise:30000}),order);
 const quote={pricePaise:9000,timestampMs:stamp().getTime()};
 const result=await executePendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",quote,nowMs:quote.timestampMs+1000,serverTimestamp:stamp});
 assert.equal(result.status,"FILLED");
 assert.equal(h.records.get("accounts/user-1").cashPaise,73000);
 assert.equal(h.records.get("accounts/user-1").reservedCashPaise,0);
 assert.equal(h.records.get("accounts/user-1").positions["NSE_EQ|ABC"].quantity,3);
 const replay=await executePendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",quote,nowMs:quote.timestampMs+1000,serverTimestamp:stamp});
 assert.equal(replay.idempotentReplay,true);
 assert.equal(h.records.get("accounts/user-1").positions["NSE_EQ|ABC"].quantity,3);
});

test("fresh eligible SELL executes and releases reserved shares",async()=>{
 const order=baseOrder("SELL",{reservedCashPaise:0,reservedQuantity:3});
 const account=baseAccount({positions:{"NSE_EQ|ABC":{quantity:5,averagePricePaise:9000,costBasisPaise:45000}},reservedPositions:{"NSE_EQ|ABC":3}});
 const h=harness(account,order),quote={pricePaise:11000,timestampMs:stamp().getTime()};
 const result=await executePendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",quote,nowMs:quote.timestampMs+500,serverTimestamp:stamp});
 assert.equal(result.status,"FILLED");
 assert.equal(h.records.get("accounts/user-1").positions["NSE_EQ|ABC"].quantity,2);
 assert.equal(h.records.get("accounts/user-1").reservedPositions["NSE_EQ|ABC"],undefined);
 assert.equal(h.records.get("accounts/user-1").cashPaise,133000);
 assert.equal(h.records.get("accounts/user-1").realizedPnlPaise,6000);
});

test("stale or not-yet-reached quotes leave order and reservations untouched",async()=>{
 const order=baseOrder("BUY",{reservedCashPaise:30000,reservedQuantity:0});
 const h=harness(baseAccount({reservedCashPaise:30000}),order);
 const now=stamp().getTime();
 const stale=await executePendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",quote:{pricePaise:9000,timestampMs:now-15001},nowMs:now,serverTimestamp:stamp});
 assert.equal(stale.status,"PENDING");
 assert.equal(h.records.get("accounts/user-1").reservedCashPaise,30000);
 const unreached=await executePendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",quote:{pricePaise:10001,timestampMs:now-100},nowMs:now,serverTimestamp:stamp});
 assert.equal(unreached.reason,"LIMIT_NOT_REACHED");
 assert.equal(h.records.get("orders/order-1").status,"PENDING");
});

test("cancel after a completed LIMIT fill is rejected without changing the filled position",async()=>{
 const order=baseOrder("BUY",{status:"FILLED",reservedCashPaise:0,reservedQuantity:0,reservationReleased:true});
 const account=baseAccount({cashPaise:73000,positions:{"NSE_EQ|ABC":{quantity:3,averagePricePaise:9000,costBasisPaise:27000}},version:3});
 const h=harness(account,order);
 await assert.rejects(cancelPendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",serverTimestamp:stamp}),{status:409});
 assert.equal(h.records.get("accounts/user-1").positions["NSE_EQ|ABC"].quantity,3);
 assert.equal(h.records.get("accounts/user-1").cashPaise,73000);
 assert.equal(h.records.get("orders/order-1").status,"FILLED");
});

test("a cancelled LIMIT order cannot execute later or alter released reservations",async()=>{
 const order=baseOrder("BUY",{status:"CANCELLED",reservedCashPaise:30000,reservedQuantity:0,reservationReleased:true});
 const account=baseAccount({reservedCashPaise:0,version:3});
 const h=harness(account,order);
 const result=await executePendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",quote:{pricePaise:9000,timestampMs:stamp().getTime()},nowMs:stamp().getTime(),serverTimestamp:stamp});
 assert.equal(result.status,"CANCELLED");
 assert.equal(result.notExecuted,true);
 assert.equal(h.records.get("accounts/user-1").cashPaise,100000);
 assert.equal(h.records.get("accounts/user-1").reservedCashPaise,0);
 assert.equal(h.records.get("orders/order-1").status,"CANCELLED");
});

test("rejects foreign-account order access and inconsistent reservations",async()=>{
 const order=baseOrder("BUY",{reservedCashPaise:30000,reservedQuantity:0});
 const h=harness(baseAccount({reservedCashPaise:30000}),order);
 await assert.rejects(cancelPendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"other-user",serverTimestamp:stamp}),TypeError);
 const broken=harness(baseAccount({reservedCashPaise:1}),order);
 await assert.rejects(cancelPendingLimitOrder({db:broken.db,accountRef:broken.accountRef,orderRef:broken.orderRef,uid:"user-1",serverTimestamp:stamp}),{status:409});
});


test("concurrent cancellation and execution serialize with cancellation winning safely",async()=>{
 const order=baseOrder("BUY",{reservedCashPaise:30000,reservedQuantity:0});
 const h=harness(baseAccount({reservedCashPaise:30000}),order);
 const quote={pricePaise:9000,timestampMs:stamp().getTime()};
 const [cancel,execution]=await Promise.all([
  cancelPendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",serverTimestamp:stamp}),
  executePendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",quote,nowMs:quote.timestampMs+1000,serverTimestamp:stamp})
 ]);
 assert.equal(cancel.status,"CANCELLED");
 assert.equal(execution.status,"CANCELLED");
 assert.equal(execution.notExecuted,true);
 assert.equal(h.records.get("orders/order-1").status,"CANCELLED");
 assert.equal(h.records.get("accounts/user-1").cashPaise,100000);
 assert.equal(h.records.get("accounts/user-1").reservedCashPaise,0);
 assert.equal(h.records.get("accounts/user-1").positions["NSE_EQ|ABC"],undefined);
});

test("concurrent execution and cancellation serialize with fill winning exactly once",async()=>{
 const order=baseOrder("BUY",{reservedCashPaise:30000,reservedQuantity:0});
 const h=harness(baseAccount({reservedCashPaise:30000}),order);
 const quote={pricePaise:9000,timestampMs:stamp().getTime()};
 const [execution,cancel]=await Promise.allSettled([
  executePendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",quote,nowMs:quote.timestampMs+1000,serverTimestamp:stamp}),
  cancelPendingLimitOrder({db:h.db,accountRef:h.accountRef,orderRef:h.orderRef,uid:"user-1",serverTimestamp:stamp})
 ]);
 assert.equal(execution.status,"fulfilled");
 assert.equal(execution.value.status,"FILLED");
 assert.equal(h.records.get("orders/order-1").status,"FILLED");
 assert.equal(h.records.get("accounts/user-1").cashPaise,73000);
 assert.equal(h.records.get("accounts/user-1").reservedCashPaise,0);
 assert.equal(h.records.get("accounts/user-1").positions["NSE_EQ|ABC"].quantity,3);
 assert.equal(cancel.status,"rejected");
 assert.equal(cancel.reason.status,409);
});
