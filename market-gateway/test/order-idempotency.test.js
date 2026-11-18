"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {isUuid,makeOrderId,makeOrderFingerprint,buildPaperOrderUpdate,assertIdempotentReplay}=require("../lib/order-idempotency");
const key="550e8400-e29b-41d4-a716-446655440000";
const request={instrumentKey:"NSE_EQ|INE009A01021",side:"BUY",quantity:3};
test("accepts UUID v4 and rejects malformed identifiers",()=>{assert.equal(isUuid(key),true);assert.equal(isUuid("not-a-uuid"),false);assert.equal(isUuid("00000000-0000-0000-0000-000000000000"),false);});
test("order document IDs are stable and user scoped",()=>{assert.equal(makeOrderId("user-a",key),makeOrderId("user-a",key));assert.notEqual(makeOrderId("user-a",key),makeOrderId("user-b",key));});
test("fingerprint is stable and changes with any order field",()=>{const fp=makeOrderFingerprint(request);assert.equal(fp,makeOrderFingerprint({...request}));assert.notEqual(fp,makeOrderFingerprint({...request,quantity:4}));assert.notEqual(fp,makeOrderFingerprint({...request,side:"SELL"}));assert.notEqual(fp,makeOrderFingerprint({...request,instrumentKey:"NSE_EQ|OTHER"}));});
test("same idempotency key replay is accepted only for identical order",()=>{const fp=makeOrderFingerprint(request);assert.equal(assertIdempotentReplay({requestFingerprint:fp},fp),true);assert.throws(()=>assertIdempotentReplay({requestFingerprint:fp},makeOrderFingerprint({...request,quantity:4})),{status:409});});

test("paper account transitions compose without losing earlier concurrent state",()=>{
 const start={cashPaise:100000,realizedPnlPaise:0,positions:{},version:1};
 const first=buildPaperOrderUpdate(start,{instrumentKey:"NSE_EQ|AAA",side:"BUY",quantity:5,pricePaise:1000});
 const second=buildPaperOrderUpdate(first,{instrumentKey:"NSE_EQ|BBB",side:"BUY",quantity:2,pricePaise:5000});
 const third=buildPaperOrderUpdate(second,{instrumentKey:"NSE_EQ|AAA",side:"SELL",quantity:2,pricePaise:1500});
 assert.equal(first.cashPaise,95000);
 assert.equal(second.cashPaise,85000);
 assert.equal(third.cashPaise,88000);
 assert.deepEqual(third.positions["NSE_EQ|AAA"],{quantity:3,averagePricePaise:1000});
 assert.deepEqual(third.positions["NSE_EQ|BBB"],{quantity:2,averagePricePaise:5000});
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
