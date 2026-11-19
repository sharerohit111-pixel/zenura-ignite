"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {
  canRetryPendingPaperOrder,readPendingPaperOrder,writePendingPaperOrder,clearPendingPaperOrder
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