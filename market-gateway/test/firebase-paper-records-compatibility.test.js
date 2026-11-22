"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fixtures=require("./fixtures/firebase-paper-trading-compatibility.json");
const {normalizeFirebasePaperAccount,normalizeFirebaseCashOrder}=require("../lib/compat/firebase-paper-records");

const identity=fixtures.identity;
test("account staging requires an explicit Firebase-to-Supabase identity mapping",()=>{
 assert.throws(()=>normalizeFirebasePaperAccount({firebaseUid:identity.firebaseUid,account:fixtures.account}),{status:400});
 assert.throws(()=>normalizeFirebasePaperAccount({firebaseUid:identity.firebaseUid,supabaseAuthUserId:"not-a-uuid",account:fixtures.account}),{status:400});
});
test("account staging preserves INR paise balances and separated product positions",()=>{
 const result=normalizeFirebasePaperAccount({...identity,account:fixtures.account});
 assert.equal(result.authUserId,identity.supabaseAuthUserId);
 assert.equal(result.sourceFirebaseUid,identity.firebaseUid);
 assert.equal(result.startingCashPaise,100000000);
 assert.equal(result.cashPaise,98765000);
 assert.deepEqual(result.positions,fixtures.account.positions);
 assert.deepEqual(result.intradayPositions,fixtures.account.intradayPositions);
 assert.deepEqual(result.derivativePositions,fixtures.account.derivativePositions);
 assert.equal(result.version,7);
});
test("legacy account fallback preserves historical starting cash and Delivery P&L",()=>{
 const result=normalizeFirebasePaperAccount({...identity,account:fixtures.legacyAccount});
 assert.equal(result.startingCashPaise,75000000,"do not replace historical capital with the current new-user default");
 assert.equal(result.deliveryRealizedPnlPaise,50000);
 assert.equal(result.intradayRealizedPnlPaise,0);
 assert.deepEqual(result.intradayPositions,{});
 assert.deepEqual(result.derivativePositions,{});
});
test("account staging rejects unsafe paise values and malformed reservations",()=>{
 for(const patch of [
  {cashPaise:1.5},
  {startingCashPaise:-1},
  {reservedCashPaise:fixtures.account.cashPaise+1},
  {positions:[]}
 ]){
  assert.throws(()=>normalizeFirebasePaperAccount({...identity,account:{...fixtures.account,...patch}}),{status:400});
 }
});
test("cash order staging retains source document ID and fingerprint without inventing legacy UUID",()=>{
 const result=normalizeFirebaseCashOrder({...identity,firestoreOrderId:"firestore-sha256-order-id",order:fixtures.cashOrder});
 assert.equal(result.sourceFirestoreOrderId,"firestore-sha256-order-id");
 assert.equal(result.requestFingerprint,fixtures.cashOrder.requestFingerprint);
 assert.equal(result.legacyIdempotencyKey,null);
 assert.equal(result.sourceOrder.grossPaise,100000);
 assert.equal(result.sourceOrder.product,"DELIVERY");
});
test("legacy cash order staging allows absent optional fields but still requires owner and fingerprint",()=>{
 const result=normalizeFirebaseCashOrder({...identity,firestoreOrderId:"legacy-order-id",order:fixtures.legacyCashOrder});
 assert.equal(result.legacyIdempotencyKey,null);
 assert.equal(result.sourceOrder.quoteTimestampMs,undefined);
 assert.throws(()=>normalizeFirebaseCashOrder({...identity,firestoreOrderId:"bad",order:{...fixtures.cashOrder,uid:"other-user"}}),{status:400});
 assert.throws(()=>normalizeFirebaseCashOrder({...identity,firestoreOrderId:"bad",order:{...fixtures.cashOrder,requestFingerprint:""}}),{status:400});
});
