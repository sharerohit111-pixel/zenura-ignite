"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {canRetryPendingPaperOrder}=require("./paper-order-retry-policy");

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
