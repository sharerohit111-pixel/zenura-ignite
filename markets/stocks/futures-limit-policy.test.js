"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const policy=require("./futures-limit-policy");

const future={exchange:"NSE",segment:"NSE_FO",instrument_type:"FUT",
  instrument_key:"NSE_FO|NIFTY26NOVFUT",trading_symbol:"NIFTY26NOVFUT",lot_size:25,tick_size:5};

test("supports only verified NSE Futures contracts",()=>{
  assert.equal(policy.isSupportedNseFuture(future),true);
  assert.equal(policy.isSupportedNseFuture({...future,lot_size:"25",tick_size:"0.05"}),true);
  assert.equal(policy.isSupportedNseFuture({...future,exchange:"BSE",segment:"BSE_FO"}),false);
  assert.equal(policy.isSupportedNseFuture({...future,instrument_type:"CE"}),false);
  assert.equal(policy.isSupportedNseFuture({...future,lot_size:0}),false);
  assert.equal(policy.isSupportedNseFuture({...future,tick_size:0.001}),false);
});

test("converts valid rupee limit prices to integer paise and enforces tick size",()=>{
  assert.equal(policy.parseLimitPricePaise("123.45",5),12345);
  assert.equal(policy.parseLimitPricePaise("123.40",5),12340);
  for(const value of ["0","-1","123.456","123.41","1e3","  ","999999999.00"])
    assert.equal(policy.parseLimitPricePaise(value,5),null);
  assert.equal(policy.normalizeTickSizePaise(0.05),5);
  assert.equal(policy.normalizeTickSizePaise(5),5);
});

test("requires both submit and worker flags before enabling the ticket",()=>{
  assert.equal(policy.isEnabled({futuresLimitSubmissionEnabled:true,futuresLimitWorker:{enabled:true}}),true);
  assert.equal(policy.isEnabled({futuresLimitSubmissionEnabled:true,futuresLimitWorker:{enabled:false}}),false);
  assert.equal(policy.isEnabled({futuresLimitSubmissionEnabled:false,futuresLimitWorker:{enabled:true}}),false);
  assert.equal(policy.isEnabled(null),false);
});

test("builds stable fingerprint and validates lots/product/side",()=>{
  const args={instrumentKey:future.instrument_key,side:"BUY",lots:2,product:"DELIVERY",limitPricePaise:12345};
  assert.equal(policy.fingerprint(args),JSON.stringify({
    instrument_key:future.instrument_key,side:"BUY",lots:2,product:"DELIVERY",
    limit_price_paise:12345,order_type:"LIMIT"
  }));
  assert.equal(policy.fingerprint({...args,lots:0}),null);
  assert.equal(policy.fingerprint({...args,side:"HOLD"}),null);
  assert.equal(policy.fingerprint({...args,product:"MARGIN"}),null);
});
