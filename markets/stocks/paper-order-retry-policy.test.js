"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {
  userScopedStorageKey,canRetryPendingPaperOrder,readPendingPaperOrder,writePendingPaperOrder,clearPendingPaperOrder,
  inspectLegacyPendingPaperOrder
}=require("./paper-order-retry-policy");

const key="123e4567-e89b-42d3-a456-426614174000";
function memoryStorage(){
  const values=new Map();
  return {
    getItem:name=>values.has(name)?values.get(name):null,
    setItem:(name,value)=>values.set(name,value),
    removeItem:name=>values.delete(name)
  };
}

test("scopes pending order storage keys to the authenticated user",()=>{
  assert.equal(userScopedStorageKey("paper-pending","user-a"),"paper-pending:user-a");
  assert.equal(userScopedStorageKey("paper-pending","user b"),"paper-pending:user%20b");
  assert.notEqual(userScopedStorageKey("paper-pending","user-a"),userScopedStorageKey("paper-pending","user-b"));
  assert.equal(userScopedStorageKey("paper-pending",""),null);
  assert.equal(userScopedStorageKey("", "user-a"),null);
});

test("keeps cash and derivative pending records isolated across user accounts",()=>{
  const storage=memoryStorage();
  const cashA=userScopedStorageKey("cash-pending","user-a");
  const cashB=userScopedStorageKey("cash-pending","user-b");
  const derivativeA=userScopedStorageKey("derivative-pending","user-a");
  const fingerprint="NSE_EQ|ABC|BUY|2";
  const pendingA={fingerprint,key};
  const pendingB={fingerprint:"NSE_EQ|XYZ|SELL|1",key:"223e4567-e89b-42d3-a456-426614174000"};
  assert.equal(writePendingPaperOrder(storage,cashA,pendingA),true);
  assert.equal(writePendingPaperOrder(storage,cashB,pendingB),true);
  assert.equal(writePendingPaperOrder(storage,derivativeA,{...pendingA,key:"323e4567-e89b-42d3-a456-426614174000"}),true);
  assert.deepEqual(readPendingPaperOrder(storage,cashA),pendingA);
  assert.deepEqual(readPendingPaperOrder(storage,cashB),pendingB);
  assert.notDeepEqual(readPendingPaperOrder(storage,derivativeA),readPendingPaperOrder(storage,cashA));
  assert.equal(clearPendingPaperOrder(storage,cashA),true);
  assert.equal(readPendingPaperOrder(storage,cashA),null);
  assert.deepEqual(readPendingPaperOrder(storage,cashB),pendingB);
  assert.equal(readPendingPaperOrder(storage,derivativeA).fingerprint,fingerprint);
});

test("allows retry only for the same pending paper order fingerprint",()=>{
  const fingerprint=JSON.stringify({instrument_key:"NSE_EQ|INE001A01036",side:"BUY",quantity:2});
  assert.equal(canRetryPendingPaperOrder(fingerprint,fingerprint),true);
  assert.equal(canRetryPendingPaperOrder(fingerprint,JSON.stringify({instrument_key:"NSE_EQ|INE001A01036",side:"SELL",quantity:2})),false);
  assert.equal(canRetryPendingPaperOrder(fingerprint,JSON.stringify({instrument_key:"NSE_EQ|INE001A01036",side:"BUY",quantity:3})),false);
  assert.equal(canRetryPendingPaperOrder(fingerprint,JSON.stringify({instrument_key:"NSE_EQ|INE002A01018",side:"BUY",quantity:2})),false);
});

test("does not treat a missing pending fingerprint as a retry",()=>{
  assert.equal(canRetryPendingPaperOrder("", "next"),false);
  assert.equal(canRetryPendingPaperOrder(null, "next"),false);
});

test("restores a valid pending order after a page reload",()=>{
  const storage=memoryStorage(),pending={fingerprint:"NSE_EQ|ABC|BUY|2",key};
  assert.equal(writePendingPaperOrder(storage,"paper-pending",pending),true);
  assert.deepEqual(readPendingPaperOrder(storage,"paper-pending"),pending);
});

test("clears a completed or definitively rejected pending order",()=>{
  const storage=memoryStorage();
  writePendingPaperOrder(storage,"paper-pending",{fingerprint:"NSE_EQ|ABC|BUY|2",key});
  assert.equal(clearPendingPaperOrder(storage,"paper-pending"),true);
  assert.equal(readPendingPaperOrder(storage,"paper-pending"),null);
});

test("ignores corrupt or invalid pending order storage",()=>{
  const storage=memoryStorage();
  storage.setItem("bad","{");
  storage.setItem("bad-key",JSON.stringify({fingerprint:"x",key:"not-a-uuid"}));
  assert.equal(readPendingPaperOrder(storage,"bad"),null);
  assert.equal(readPendingPaperOrder(storage,"bad-key"),null);
  assert.equal(writePendingPaperOrder(storage,"bad-key",{fingerprint:"x",key:"invalid"}),false);
});

test("storage failures are contained without throwing into order flow",()=>{
  const storage={
    getItem(){throw new Error("blocked");},
    setItem(){throw new Error("blocked");},
    removeItem(){throw new Error("blocked");}
  };
  assert.equal(readPendingPaperOrder(storage,"pending"),null);
  assert.equal(writePendingPaperOrder(storage,"pending",{fingerprint:"x",key}),false);
  assert.equal(clearPendingPaperOrder(storage,"pending"),false);
});
test("migrates a legacy pending order only when its stored UID matches the authenticated user",()=>{
  const storage=memoryStorage(),legacyKey="legacy-pending",scopedKey="legacy-pending:user-a";
  const pending={fingerprint:"NSE_EQ|ABC|BUY|2",key};
  storage.setItem(legacyKey,JSON.stringify({...pending,uid:"user-a"}));
  const result=inspectLegacyPendingPaperOrder(storage,legacyKey,"user-a",scopedKey);
  assert.equal(result.state,"migrated");
  assert.deepEqual(result.pending,pending);
  assert.deepEqual(readPendingPaperOrder(storage,scopedKey),pending);
  assert.equal(storage.getItem(legacyKey),null);
});

test("does not migrate a legacy pending order without a matching UID",()=>{
  const storage=memoryStorage(),legacyKey="legacy-pending";
  storage.setItem(legacyKey,JSON.stringify({fingerprint:"NSE_EQ|ABC|BUY|2",key}));
  const result=inspectLegacyPendingPaperOrder(storage,legacyKey,"user-a","legacy-pending:user-a");
  assert.equal(result.state,"ambiguous");
  assert.equal(readPendingPaperOrder(storage,"legacy-pending:user-a"),null);
  assert.notEqual(storage.getItem(legacyKey),null);
});

test("does not migrate a legacy pending order belonging to another user",()=>{
  const storage=memoryStorage(),legacyKey="legacy-pending";
  storage.setItem(legacyKey,JSON.stringify({fingerprint:"NSE_EQ|ABC|BUY|2",key,uid:"user-b"}));
  const result=inspectLegacyPendingPaperOrder(storage,legacyKey,"user-a","legacy-pending:user-a");
  assert.equal(result.state,"ambiguous");
  assert.equal(readPendingPaperOrder(storage,"legacy-pending:user-a"),null);
  assert.notEqual(storage.getItem(legacyKey),null);
});

test("contains corrupt legacy records and unavailable storage without replaying them",()=>{
  const corrupt=memoryStorage();
  corrupt.setItem("legacy","{");
  assert.equal(inspectLegacyPendingPaperOrder(corrupt,"legacy","user-a","scoped").state,"ambiguous");
  const blocked={getItem(){throw new Error("blocked");},setItem(){throw new Error("blocked");},removeItem(){throw new Error("blocked");}};
  assert.equal(inspectLegacyPendingPaperOrder(blocked,"legacy","user-a","scoped").state,"unavailable");
});

test("quarantines ambiguous legacy orders once per account without blocking later new orders",()=>{
  const storage=memoryStorage(),legacyKey="legacy-pending",scopedKey="legacy-pending:user-a";
  storage.setItem(legacyKey,JSON.stringify({fingerprint:"NSE_EQ|ABC|BUY|2",key}));
  assert.equal(inspectLegacyPendingPaperOrder(storage,legacyKey,"user-a",scopedKey).state,"ambiguous");
  assert.equal(inspectLegacyPendingPaperOrder(storage,legacyKey,"user-a",scopedKey).state,"quarantined");
  assert.equal(readPendingPaperOrder(storage,scopedKey),null);
  assert.notEqual(storage.getItem(legacyKey),null);
});
test("quarantines malformed legacy JSON and contains marker write failures",()=>{
  const storage=memoryStorage();
  storage.setItem("legacy","{");
  assert.equal(inspectLegacyPendingPaperOrder(storage,"legacy","user-a","scoped").state,"ambiguous");
  assert.equal(inspectLegacyPendingPaperOrder(storage,"legacy","user-a","scoped").state,"quarantined");
  const blocked={getItem:()=>"{",setItem(){throw new Error("blocked");},removeItem(){}};
  assert.equal(inspectLegacyPendingPaperOrder(blocked,"legacy","user-a","scoped").state,"unavailable");
});
