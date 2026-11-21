"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {parseLimitPricePaise}=require("../lib/limit-price");

test("parses valid INR LIMIT prices into integer paise",()=>{
  for(const [input,expected] of [["125",12500],["125.5",12550],["125.50",12550],["0.01",1],["12345678.99",1234567899]]) {
    assert.equal(parseLimitPricePaise(input),expected,input);
  }
});

test("rejects malformed, over-precision, negative and zero LIMIT prices",()=>{
  for(const input of ["1.234","-1","abc","","0","0.00","123456789","1e3"," 125.50"]) {
    assert.equal(parseLimitPricePaise(input),null,input);
  }
});
