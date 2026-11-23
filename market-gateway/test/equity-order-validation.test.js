"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizeEquityTickSizePaise,isEquityExecutionPriceOnTick}=require("../lib/equity-order-validation");

test("normalizes official equity tick sizes expressed in paise or legacy rupees",()=>{
  assert.equal(normalizeEquityTickSizePaise(5),5);
  assert.equal(normalizeEquityTickSizePaise("5"),5);
  assert.equal(normalizeEquityTickSizePaise(0.05),5);
  assert.equal(normalizeEquityTickSizePaise("0.05"),5);
  assert.equal(normalizeEquityTickSizePaise(0.1),10);
});

test("rejects absent, non-finite, non-positive and sub-paise tick sizes",()=>{
  for(const value of [null,undefined,"",0,-5,NaN,Infinity,"abc",0.001]) {
    assert.equal(normalizeEquityTickSizePaise(value),null,String(value));
  }
});

test("validates MARKET execution prices as integer paise multiples of official tick",()=>{
  assert.equal(isEquityExecutionPriceOnTick(12345,5),true);
  assert.equal(isEquityExecutionPriceOnTick(12340,10),true);
  assert.equal(isEquityExecutionPriceOnTick(12347,5),false);
  assert.equal(isEquityExecutionPriceOnTick(0,5),false);
  assert.equal(isEquityExecutionPriceOnTick(12345,0),false);
  assert.equal(isEquityExecutionPriceOnTick(12345.5,5),false);
});
