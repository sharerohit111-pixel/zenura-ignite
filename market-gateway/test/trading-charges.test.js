"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {calculateLongOptionBuyCharges}=require("../lib/trading-charges");

test("NSE option BUY estimates brokerage, exchange, stamp duty and GST without STT",()=>{
 const c=calculateLongOptionBuyCharges({grossPaise:81250,exchange:"NSE"});
 assert.equal(c.brokeragePaise,2000);
 assert.equal(c.exchangeTransactionPaise,29);
 assert.equal(c.ipftPaise,0);
 assert.equal(c.sebiPaise,0);
 assert.equal(c.stampDutyPaise,2);
 assert.equal(c.gstPaise,365);
 assert.equal(c.sttPaise,0);
 assert.equal(c.totalChargesPaise,2396);
 assert.equal(c.totalDebitPaise,83646);
 assert.equal(c.indicative,true);
});

test("BSE option BUY uses BSE exchange transaction rate",()=>{
 const c=calculateLongOptionBuyCharges({grossPaise:100000,exchange:"BSE"});
 assert.equal(c.exchangeTransactionPaise,33);
 assert.equal(c.totalChargesPaise,2402);
});

test("rejects invalid turnover, exchange and brokerage",()=>{
 assert.throws(()=>calculateLongOptionBuyCharges({grossPaise:0,exchange:"NSE"}),/turnover/);
 assert.throws(()=>calculateLongOptionBuyCharges({grossPaise:10000,exchange:"MCX"}),/Only NSE and BSE/);
 assert.throws(()=>calculateLongOptionBuyCharges({grossPaise:10000,exchange:"NSE",brokeragePaise:-1}),/Brokerage/);
});
