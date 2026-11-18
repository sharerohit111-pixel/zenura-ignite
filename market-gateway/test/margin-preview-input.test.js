"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {parseMarginPreviewInput}=require("../lib/margin-preview-input");

test("accepts a valid numeric lot count and normalizes side and product",()=>{
 assert.deepEqual(parseMarginPreviewInput({instrument_key:" NSE_FO|NIFTY26NOVFUT ",lots:2,side:"buy",product:"i"}),{
  instrumentKey:"NSE_FO|NIFTY26NOVFUT",lots:2,side:"BUY",product:"I"
 });
});
test("defaults margin product to delivery",()=>{
 assert.equal(parseMarginPreviewInput({instrument_key:"NSE_FO|NIFTY26NOVFUT",lots:1,side:"SELL"}).product,"D");
});
test("rejects missing or non-object request bodies",()=>{
 for(const body of [null,undefined,[], "x", 1])assert.throws(()=>parseMarginPreviewInput(body),{status:400});
});
test("rejects coerced, fractional, unsafe and out-of-range lot counts",()=>{
 for(const lots of ["1",true,false,null,1.5,0,-1,10001,Number.MAX_SAFE_INTEGER])
  assert.throws(()=>parseMarginPreviewInput({instrument_key:"NSE_FO|NIFTY26NOVFUT",lots,side:"BUY"}),/Lots/);
});
test("rejects invalid instrument keys",()=>{
 for(const instrument_key of ["", "  ", "x".repeat(101), "NSE_FO|BAD\nKEY", 123, null])
  assert.throws(()=>parseMarginPreviewInput({instrument_key,lots:1,side:"BUY"}),/instrument_key/);
});
test("rejects invalid sides and product types",()=>{
 for(const side of ["", "BUY_SELL", 1, null])
  assert.throws(()=>parseMarginPreviewInput({instrument_key:"NSE_FO|NIFTY26NOVFUT",lots:1,side}),/side/);
 for(const product of ["", "CO", 1, null])
  assert.throws(()=>parseMarginPreviewInput({instrument_key:"NSE_FO|NIFTY26NOVFUT",lots:1,side:"BUY",product}),/product/);
});
