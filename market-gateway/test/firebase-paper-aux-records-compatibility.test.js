"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fixtures=require("./fixtures/firebase-paper-trading-extended-compatibility.json");
const {normalizeFirebaseLimitOrder,normalizeFirebaseDerivativeOrder,normalizeFirebaseWatchlists,classifyFirebaseEphemeralRecord}=require("../lib/compat/firebase-paper-aux-records");
const {isOAuthStateUsable}=require("../../functions/lib/upstox-oauth-state");
const identity={firebaseUid:"firebase-user-fixture-001",supabaseAuthUserId:"550e8400-e29b-41d4-a716-446655440000"};
test("LIMIT BUY fixture preserves pending cash reservation and source identity",()=>{
 const result=normalizeFirebaseLimitOrder({...identity,firestoreOrderId:"limit-buy-doc",order:fixtures.limitOrders[0]});
 assert.equal(result.order.reservedCashPaise,101000);
 assert.equal(result.order.reservationReleased,false);
 assert.equal(result.legacyIdempotencyKey,null);
});
test("terminal LIMIT order preserves released reservation state",()=>{
 const result=normalizeFirebaseLimitOrder({...identity,firestoreOrderId:"limit-sell-doc",order:fixtures.limitOrders[1]});
 assert.equal(result.order.status,"CANCELLED");
 assert.equal(result.order.reservationReleased,true);
 assert.equal(result.order.reservedQuantity,1);
});
test("LIMIT order rejects inconsistent BUY reservation and mismatched owner",()=>{
 assert.throws(()=>normalizeFirebaseLimitOrder({...identity,firestoreOrderId:"bad",order:{...fixtures.limitOrders[0],reservedCashPaise:0}}),{status:400});
 assert.throws(()=>normalizeFirebaseLimitOrder({...identity,firestoreOrderId:"bad",order:{...fixtures.limitOrders[0],uid:"other"}}),{status:400});
});
test("derivative order preserves the full historical charges JSON breakdown",()=>{
 const result=normalizeFirebaseDerivativeOrder({...identity,firestoreOrderId:"derivative-doc",order:fixtures.derivativeOrder});
 assert.equal(result.order.grossPaise,31250);
 assert.equal(result.charges.totalChargesPaise,2374);
 assert.deepEqual(result.order.charges,fixtures.derivativeOrder.charges);
 assert.equal(result.legacyIdempotencyKey,null);
});
test("derivative order rejects inconsistent charges",()=>{
 assert.throws(()=>normalizeFirebaseDerivativeOrder({...identity,firestoreOrderId:"bad",order:{...fixtures.derivativeOrder,chargesPaise:1}}),{status:400});
});
test("watchlists retain only supported named lists, deduplicate, and cap at 50",()=>{
 const normalized=normalizeFirebaseWatchlists({watchlists:{"My Stocks":["A","A",1,"B"],"Banking":["X"],"Unknown":["NO"]}});
 assert.deepEqual(normalized["My Stocks"],["A","B"]);
 assert.deepEqual(normalized.Banking,["X"]);
 assert.deepEqual(normalized.NIFTY,[]);
 assert.deepEqual(normalized["F&O"],[]);
 assert.equal(normalizeFirebaseWatchlists({instrumentKeys:["LEGACY"]})["My Stocks"][0],"LEGACY");
});
test("OAuth one-time state is runtime-validated and not copied as migration data",()=>{
 const now=1795168800000;
 const state={uid:identity.firebaseUid,used:false,expiresAt:{toMillis:()=>now+60000}};
 assert.equal(isOAuthStateUsable(state,now),true);
 assert.equal(isOAuthStateUsable({...state,used:true},now),false);
 assert.equal(isOAuthStateUsable({...state,expiresAt:{toMillis:()=>now}},now),false);
 for(const kind of ["oauthState","oauthConnectionEnvelope","streamLease","connectionControl","workerCursor","marginRateLimit"]){
  const classification=classifyFirebaseEphemeralRecord(kind);
  assert.equal(classification.migratable,false);
  assert.equal(classification.action,"recreate-after-cutover");
 }
});
