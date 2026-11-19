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
 assert.equal(c.ipftPaise,0);
 assert.equal(c.totalChargesPaise,2402);
});

test("NSE IPFT uses Upstox ₹0.50 per lakh option-premium schedule and is included in GST",()=>{
 const c=calculateLongOptionBuyCharges({grossPaise:10000000,exchange:"NSE"});
 assert.equal(c.ipftPaise,50);
 assert.equal(c.gstPaise,1009);
});

test("rejects invalid turnover, exchange and brokerage",()=>{
 assert.throws(()=>calculateLongOptionBuyCharges({grossPaise:0,exchange:"NSE"}),/turnover/);
 assert.throws(()=>calculateLongOptionBuyCharges({grossPaise:10000,exchange:"MCX"}),/Only NSE and BSE/);
 assert.throws(()=>calculateLongOptionBuyCharges({grossPaise:10000,exchange:"NSE",brokeragePaise:-1}),/Brokerage/);
});

test("NSE option SELL applies STT to premium and does not charge buy-side stamp duty",()=>{
 const {calculateLongOptionTradeCharges}=require("../lib/trading-charges");
 const c=calculateLongOptionTradeCharges({grossPaise:97500,exchange:"NSE",side:"SELL"});
 assert.equal(c.sttPaise,146);
 assert.equal(c.stampDutyPaise,0);
 assert.equal(c.exchangeTransactionPaise,35);
 assert.equal(c.ipftPaise,0);
 assert.equal(c.gstPaise,366);
 assert.equal(c.totalChargesPaise,2547);
 assert.equal(c.netCreditPaise,94953);
 assert.equal(c.totalDebitPaise,null);
});

test("option sell reports a negative net settlement when charges exceed tiny premium",()=>{
 const {calculateLongOptionTradeCharges}=require("../lib/trading-charges");
 const c=calculateLongOptionTradeCharges({grossPaise:100,exchange:"NSE",side:"SELL"});
 assert.ok(c.totalChargesPaise>c.grossPaise);
 assert.equal(c.netCreditPaise,c.grossPaise-c.totalChargesPaise);
 assert.ok(c.netCreditPaise<0);
});
test("NSE option exchange and IPFT charges use the published premium turnover rates",()=>{
 const c=calculateLongOptionBuyCharges({grossPaise:100000000,exchange:"NSE"});
 assert.equal(c.exchangeTransactionPaise,35530);
 assert.equal(c.ipftPaise,500);
 assert.equal(c.gstPaise,6845);
});
