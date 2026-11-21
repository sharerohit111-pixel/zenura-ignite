"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {isUuid,makeOrderId,makeOrderFingerprint,buildPaperOrderUpdate,assertIdempotentReplay}=require("../lib/order-idempotency");
const key="550e8400-e29b-41d4-a716-446655440000";
const request={instrumentKey:"NSE_EQ|INE009A01021",side:"BUY",quantity:3,orderType:"MARKET"};
test("accepts UUID v4 and rejects malformed identifiers",()=>{assert.equal(isUuid(key),true);assert.equal(isUuid("not-a-uuid"),false);assert.equal(isUuid("00000000-0000-0000-0000-000000000000"),false);});
test("order document IDs are stable and user scoped",()=>{assert.equal(makeOrderId("user-a",key),makeOrderId("user-a",key));assert.notEqual(makeOrderId("user-a",key),makeOrderId("user-b",key));});
test("market fingerprint remains backward-compatible while limit type changes it",()=>{const crypto=require("node:crypto");const legacy=crypto.createHash("sha256").update(JSON.stringify({instrumentKey:request.instrumentKey,side:request.side,quantity:request.quantity})).digest("hex");assert.equal(makeOrderFingerprint(request),legacy);assert.notEqual(makeOrderFingerprint(request),makeOrderFingerprint({...request,orderType:"LIMIT",limitPricePaise:12500}));});
test("fingerprint is stable and changes with any order field",()=>{const fp=makeOrderFingerprint(request);assert.equal(fp,makeOrderFingerprint({...request}));assert.notEqual(fp,makeOrderFingerprint({...request,quantity:4}));assert.notEqual(fp,makeOrderFingerprint({...request,side:"SELL"}));assert.notEqual(fp,makeOrderFingerprint({...request,instrumentKey:"NSE_EQ|OTHER"}));assert.notEqual(fp,makeOrderFingerprint({...request,orderType:"LIMIT",limitPricePaise:12500}));});
test("same idempotency key replay is accepted only for identical order",()=>{const fp=makeOrderFingerprint(request);assert.equal(assertIdempotentReplay({requestFingerprint:fp},fp),true);assert.throws(()=>assertIdempotentReplay({requestFingerprint:fp},makeOrderFingerprint({...request,quantity:4})),{status:409});});

test("paper account transitions compose without losing earlier concurrent state",()=>{
 const start={cashPaise:100000,realizedPnlPaise:0,positions:{},version:1};
 const first=buildPaperOrderUpdate(start,{instrumentKey:"NSE_EQ|AAA",side:"BUY",quantity:5,pricePaise:1000});
 const second=buildPaperOrderUpdate(first,{instrumentKey:"NSE_EQ|BBB",side:"BUY",quantity:2,pricePaise:5000});
 const third=buildPaperOrderUpdate(second,{instrumentKey:"NSE_EQ|AAA",side:"SELL",quantity:2,pricePaise:1500});
 assert.equal(first.cashPaise,95000);
 assert.equal(second.cashPaise,85000);
 assert.equal(third.cashPaise,88000);
 assert.deepEqual(third.positions["NSE_EQ|AAA"],{quantity:3,averagePricePaise:1000,costBasisPaise:3000});
 assert.deepEqual(third.positions["NSE_EQ|BBB"],{quantity:2,averagePricePaise:5000,costBasisPaise:10000});
 assert.equal(third.realizedPnlPaise,1000);
 assert.equal(third.version,4);
});
test("independent stale-snapshot calculations are not a concurrency guarantee",()=>{
 const start={cashPaise:10000,realizedPnlPaise:0,positions:{},version:7};
 const a=buildPaperOrderUpdate(start,{instrumentKey:"NSE_EQ|AAA",side:"BUY",quantity:1,pricePaise:6000});
 const b=buildPaperOrderUpdate(start,{instrumentKey:"NSE_EQ|BBB",side:"BUY",quantity:1,pricePaise:6000});
 assert.equal(a.cashPaise,4000);assert.equal(b.cashPaise,4000);
 assert.equal(a.version,8);assert.equal(b.version,8);
 assert.notDeepEqual(a.positions,b.positions);
 // Both calculations start at version 7; only the Firestore transaction can
 // serialize competing writes and force the losing transaction to re-read.
});
test("rejects malformed paper account positions map",()=>assert.throws(()=>buildPaperOrderUpdate({cashPaise:1000,realizedPnlPaise:0,positions:[]},{instrumentKey:"NSE_EQ|AAA",side:"BUY",quantity:1,pricePaise:100}),{status:409}));

test("two order transitions composed sequentially cannot overspend shared cash",()=>{
 const start={cashPaise:10000,realizedPnlPaise:0,positions:{},version:1};
 const first=buildPaperOrderUpdate(start,{instrumentKey:"NSE_EQ|AAA",side:"BUY",quantity:1,pricePaise:7000});
 assert.throws(()=>buildPaperOrderUpdate(first,{instrumentKey:"NSE_EQ|BBB",side:"BUY",quantity:1,pricePaise:7000}),{status:409});
 assert.equal(first.cashPaise,3000);
});
test("a subsequent calculation uses the latest committed account snapshot",()=>{
 const account={cashPaise:10000,realizedPnlPaise:0,positions:{},version:1};
 const request={instrumentKey:"NSE_EQ|AAA",side:"BUY",quantity:2,pricePaise:1000};
 const first=buildPaperOrderUpdate(account,request);
 const nextOrderFromFreshSnapshot=buildPaperOrderUpdate(first,{...request,quantity:1});
 assert.equal(first.cashPaise,8000);
 assert.equal(nextOrderFromFreshSnapshot.cashPaise,7000);
 assert.equal(nextOrderFromFreshSnapshot.positions["NSE_EQ|AAA"].quantity,3);
 assert.equal(nextOrderFromFreshSnapshot.version,3);
});

test("rejects an exhausted or malformed account version instead of overflowing",()=>{
 const base={cashPaise:10000,realizedPnlPaise:0,positions:{},version:Number.MAX_SAFE_INTEGER};
 assert.throws(()=>buildPaperOrderUpdate(base,{instrumentKey:"NSE_EQ|AAA",side:"BUY",quantity:1,pricePaise:100}),{status:409});
 assert.throws(()=>buildPaperOrderUpdate({...base,version:0},{instrumentKey:"NSE_EQ|AAA",side:"BUY",quantity:1,pricePaise:100}),{status:409});
});

test("limit order fingerprint includes a positive limit price",()=>{
 const limit={...request,orderType:"LIMIT",limitPricePaise:12500};
 assert.equal(makeOrderFingerprint(limit),makeOrderFingerprint({...limit}));
 assert.notEqual(makeOrderFingerprint(limit),makeOrderFingerprint({...limit,limitPricePaise:12600}));
 assert.throws(()=>makeOrderFingerprint({...limit,limitPricePaise:0}),{status:400});
 assert.throws(()=>makeOrderFingerprint({...limit,limitPricePaise:1.5}),{status:400});
 assert.throws(()=>makeOrderFingerprint({...request,orderType:"MARKET",limitPricePaise:12500}),{status:400});
});

test("market BUY cannot spend cash reserved by pending LIMIT orders or margin",()=>{
 const account={cashPaise:10000,reservedCashPaise:3000,reservedMarginPaise:2000,reservedPositions:{},realizedPnlPaise:0,positions:{},version:1};
 const next=buildPaperOrderUpdate(account,{instrumentKey:"NSE_EQ|AAA",side:"BUY",quantity:1,pricePaise:5000});
 assert.equal(next.cashPaise,5000);
 assert.equal(next.reservedCashPaise,3000);
 assert.deepEqual(next.reservedPositions,{});
 assert.throws(()=>buildPaperOrderUpdate(account,{instrumentKey:"NSE_EQ|AAA",side:"BUY",quantity:1,pricePaise:5001}),{status:409});
});

test("market SELL cannot consume shares reserved by a pending LIMIT sell",()=>{
 const account={cashPaise:10000,reservedCashPaise:0,reservedPositions:{"NSE_EQ|AAA":2},realizedPnlPaise:0,positions:{"NSE_EQ|AAA":{quantity:5,averagePricePaise:1000}},version:1};
 const next=buildPaperOrderUpdate(account,{instrumentKey:"NSE_EQ|AAA",side:"SELL",quantity:3,pricePaise:1200});
 assert.equal(next.positions["NSE_EQ|AAA"].quantity,2);
 assert.deepEqual(next.reservedPositions,{"NSE_EQ|AAA":2});
 assert.throws(()=>buildPaperOrderUpdate(account,{instrumentKey:"NSE_EQ|AAA",side:"SELL",quantity:4,pricePaise:1200}),{status:409});
});

test("rejects malformed reserved cash and share reservations",()=>{
 const base={cashPaise:10000,reservedCashPaise:1000,reservedPositions:{},realizedPnlPaise:0,positions:{},version:1};
 for(const patch of [{reservedCashPaise:-1},{reservedCashPaise:10001},{reservedPositions:[]},{reservedPositions:{"NSE_EQ|AAA":1}}])
  assert.throws(()=>buildPaperOrderUpdate({...base,...patch},{instrumentKey:"NSE_EQ|AAA",side:"BUY",quantity:1,pricePaise:100}),{status:409});
});

test("closed legacy positions do not bypass the 50-open-position cap",()=>{
 const positions=Object.fromEntries(Array.from({length:50},(_,i)=>[
  `NSE_EQ|OPEN${i}`,{quantity:1,averagePricePaise:100,costBasisPaise:100}
 ]));
 positions["NSE_EQ|CLOSED"]={quantity:0,averagePricePaise:0,costBasisPaise:0};
 assert.throws(()=>buildPaperOrderUpdate(
  {cashPaise:100000,realizedPnlPaise:0,positions,version:1},
  {instrumentKey:"NSE_EQ|CLOSED",side:"BUY",quantity:1,pricePaise:100}
 ),{status:409});
 const belowLimit={...positions};delete belowLimit["NSE_EQ|OPEN49"];
 const result=buildPaperOrderUpdate(
  {cashPaise:100000,realizedPnlPaise:0,positions:belowLimit,version:1},
  {instrumentKey:"NSE_EQ|CLOSED",side:"BUY",quantity:1,pricePaise:100}
 );
 assert.equal(result.positions["NSE_EQ|CLOSED"].quantity,1);
});

test("Intraday fingerprints are distinct while Delivery retains the legacy fingerprint",()=>{
 const legacy=makeOrderFingerprint(request);
 assert.equal(makeOrderFingerprint({...request,product:"DELIVERY"}),legacy);
 assert.equal(makeOrderFingerprint({...request,product:"INTRADAY"}),makeOrderFingerprint({...request,product:"INTRADAY"}));
 assert.notEqual(makeOrderFingerprint({...request,product:"INTRADAY"}),legacy);
 assert.throws(()=>makeOrderFingerprint({...request,product:"intraday"}),{status:400});
});
test("Intraday MARKET fills use isolated holdings and shared virtual cash",()=>{
 const account={cashPaise:100000,realizedPnlPaise:250,positions:{"NSE_EQ|AAA":{quantity:2,averagePricePaise:1000}},reservedPositions:{},
  intradayPositions:{},intradayReservedPositions:{},reservedCashPaise:0,reservedMarginPaise:0,version:1};
 const intradayBuy=buildPaperOrderUpdate(account,{instrumentKey:"NSE_EQ|AAA",side:"BUY",quantity:3,pricePaise:500,product:"INTRADAY"});
 assert.equal(intradayBuy.cashPaise,98500);
 assert.equal(Object.hasOwn(intradayBuy,"positions"),false);
 assert.equal(account.positions["NSE_EQ|AAA"].quantity,2);
 assert.equal(intradayBuy.intradayPositions["NSE_EQ|AAA"].quantity,3);
 assert.equal(intradayBuy.realizedPnlPaise,250);
 assert.equal(intradayBuy.intradayRealizedPnlPaise,0);
 assert.throws(()=>buildPaperOrderUpdate(account,{instrumentKey:"NSE_EQ|AAA",side:"SELL",quantity:1,pricePaise:1200,product:"INTRADAY"}),{status:409});
 const intradaySell=buildPaperOrderUpdate(intradayBuy,{instrumentKey:"NSE_EQ|AAA",side:"SELL",quantity:2,pricePaise:700,product:"INTRADAY"});
 assert.equal(intradaySell.intradayPositions["NSE_EQ|AAA"].quantity,1);
 assert.equal(Object.hasOwn(intradaySell,"positions"),false);
 assert.equal(account.positions["NSE_EQ|AAA"].quantity,2);
 assert.equal(intradaySell.intradayRealizedPnlPaise,400);
 assert.equal(intradaySell.realizedPnlPaise,650);
});
test("Delivery fills keep legacy position maps and attribute legacy P&L to Delivery",()=>{
 const account={cashPaise:10000,realizedPnlPaise:300,positions:{"NSE_EQ|AAA":{quantity:2,averagePricePaise:1000}},reservedPositions:{},version:1};
 const next=buildPaperOrderUpdate(account,{instrumentKey:"NSE_EQ|AAA",side:"SELL",quantity:1,pricePaise:1200});
 assert.equal(next.positions["NSE_EQ|AAA"].quantity,1);
 assert.equal(next.deliveryRealizedPnlPaise,500);
 assert.equal(next.intradayRealizedPnlPaise,undefined);
 assert.equal(next.realizedPnlPaise,500);
});
