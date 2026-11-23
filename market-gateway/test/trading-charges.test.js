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

test("NSE option IPFT contribution is ₹0.01 per crore and included in GST",()=>{
 const c=calculateLongOptionBuyCharges({grossPaise:1000000000,exchange:"NSE"});
 assert.equal(c.exchangeTransactionPaise,355200);
 assert.equal(c.ipftPaise,1);
 assert.equal(c.gstPaise,64296);
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
 assert.equal(c.exchangeTransactionPaise,35520);
 assert.equal(c.ipftPaise,0);
 assert.equal(c.gstPaise,6754);
});

test("half-paise boundaries round upward exactly like PostgreSQL floor(x + 0.5)",()=>{
 const {calculateLongOptionTradeCharges}=require("../lib/trading-charges");
 const nse=calculateLongOptionTradeCharges({grossPaise:5000000,exchange:"NSE",side:"BUY",brokeragePaise:0});
 assert.equal(nse.exchangeTransactionPaise,1776);
 assert.equal(nse.ipftPaise,0);
 assert.equal(nse.sebiPaise,5);
 assert.equal(nse.stampDutyPaise,150);
 const bse=calculateLongOptionTradeCharges({grossPaise:20000,exchange:"BSE",side:"BUY",brokeragePaise:0});
 assert.equal(bse.exchangeTransactionPaise,7); // 6.5
});

test("SELL-side STT half-paise boundary rounds upward and BUY stamp duty stays zero",()=>{
 const {calculateLongOptionTradeCharges}=require("../lib/trading-charges");
 const sell=calculateLongOptionTradeCharges({grossPaise:1000,exchange:"BSE",side:"SELL",brokeragePaise:0});
 assert.equal(sell.sttPaise,2); // 1.5
 assert.equal(sell.stampDutyPaise,0);
 const buy=calculateLongOptionTradeCharges({grossPaise:50000,exchange:"BSE",side:"BUY",brokeragePaise:0});
 assert.equal(buy.stampDutyPaise,2); // 1.5
 assert.equal(buy.sttPaise,0);
});

test("brokerage override is included in GST base and zero brokerage is supported",()=>{
 const {calculateLongOptionTradeCharges}=require("../lib/trading-charges");
 const standard=calculateLongOptionTradeCharges({grossPaise:81250,exchange:"NSE",side:"BUY",brokeragePaise:2000});
 const zero=calculateLongOptionTradeCharges({grossPaise:81250,exchange:"NSE",side:"BUY",brokeragePaise:0});
 assert.equal(standard.gstPaise,365);
 assert.equal(zero.gstPaise,5);
 assert.equal(zero.brokeragePaise,0);
 assert.equal(zero.totalChargesPaise,standard.totalChargesPaise-2360);
});

test("rejects unsafe integer turnover and brokerage boundaries",()=>{
 const {calculateLongOptionTradeCharges}=require("../lib/trading-charges");
 assert.throws(()=>calculateLongOptionTradeCharges({grossPaise:Number.MAX_SAFE_INTEGER+1,exchange:"NSE"}),/turnover/);
 assert.throws(()=>calculateLongOptionTradeCharges({grossPaise:1000,exchange:"NSE",brokeragePaise:Number.MAX_SAFE_INTEGER+1}),/Brokerage/);
});

test("Firebase BigInt partial-close reference vectors conserve fee-inclusive basis across repeated closes",()=>{
 const close=(basis,qty,oldQty)=>qty===oldQty?basis:Number((BigInt(basis)*BigInt(qty)+BigInt(Math.floor(oldQty/2)))/BigInt(oldQty));
 const first=close(98778,25,75);
 const remaining1=98778-first;
 const second=close(remaining1,25,50);
 const remaining2=remaining1-second;
 assert.equal(first,32926);
 assert.equal(remaining1,65852);
 assert.equal(second,32926);
 assert.equal(remaining2,32926);
 assert.equal(remaining2+second+first,98778);
});

test("NSE futures BUY applies 2026 brokerage, exchange, SEBI, stamp and GST charges",()=>{
 const {calculateFuturesTradeCharges}=require("../lib/trading-charges");
 const c=calculateFuturesTradeCharges({grossPaise:100000000,exchange:"NSE",side:"BUY"});
 assert.equal(c.brokeragePaise,2000);
 assert.equal(c.exchangeTransactionPaise,1830);
 assert.equal(c.ipftPaise,0);
 assert.equal(c.sebiPaise,100);
 assert.equal(c.stampDutyPaise,2000);
 assert.equal(c.sttPaise,0);
 assert.equal(c.gstPaise,689);
 assert.equal(c.totalChargesPaise,6619);
 assert.equal(c.scheduleVersion,"2026-04-01");
});
test("NSE futures SELL applies the 0.05 percent STT rate effective April 2026",()=>{
 const {calculateFuturesTradeCharges}=require("../lib/trading-charges");
 const c=calculateFuturesTradeCharges({grossPaise:100000000,exchange:"NSE",side:"SELL"});
 assert.equal(c.sttPaise,50000);
 assert.equal(c.stampDutyPaise,0);
 assert.equal(c.exchangeTransactionPaise,1830);
 assert.equal(c.gstPaise,689);
 assert.equal(c.totalChargesPaise,54619);
});
test("BSE futures schedule does not apply NSE exchange transaction charges",()=>{
 const {calculateFuturesTradeCharges}=require("../lib/trading-charges");
 const c=calculateFuturesTradeCharges({grossPaise:100000000,exchange:"BSE",side:"BUY"});
 assert.equal(c.exchangeTransactionPaise,0);
 assert.equal(c.totalChargesPaise,4460);
});
test("futures brokerage is the lower of 0.05 percent or Rs 20 per executed order",()=>{
 const {calculateFuturesTradeCharges}=require("../lib/trading-charges");
 const small=calculateFuturesTradeCharges({grossPaise:100000,exchange:"NSE",side:"BUY"});
 const large=calculateFuturesTradeCharges({grossPaise:100000000,exchange:"NSE",side:"BUY"});
 assert.equal(small.brokeragePaise,50);
 assert.equal(large.brokeragePaise,2000);
});
test("futures charge calculator rejects invalid turnover, side, exchange and unsafe values",()=>{
 const {calculateFuturesTradeCharges}=require("../lib/trading-charges");
 assert.throws(()=>calculateFuturesTradeCharges({grossPaise:0,exchange:"NSE"}),/turnover/);
 assert.throws(()=>calculateFuturesTradeCharges({grossPaise:1000,exchange:"MCX"}),/NSE and BSE/);
 assert.throws(()=>calculateFuturesTradeCharges({grossPaise:1000,exchange:"NSE",side:"HOLD"}),/side/);
 assert.throws(()=>calculateFuturesTradeCharges({grossPaise:Number.MAX_SAFE_INTEGER+1,exchange:"NSE"}),/turnover/);
});

test("NSE delivery BUY includes 2026 brokerage, STT, stamp duty, exchange, SEBI and GST",()=>{
 const {calculateEquityDeliveryCharges}=require("../lib/trading-charges");
 const c=calculateEquityDeliveryCharges({grossPaise:100000000,exchange:"NSE",side:"BUY"});
 assert.equal(c.brokeragePaise,2000);
 assert.equal(c.exchangeTransactionPaise,3070);
 assert.equal(c.sttPaise,100000);
 assert.equal(c.stampDutyPaise,15000);
 assert.equal(c.dpChargesPaise,0);
 assert.equal(c.gstPaise,913);
 assert.equal(c.totalChargesPaise,121083);
});
test("NSE delivery SELL includes STT and estimated per-order DP charge",()=>{
 const {calculateEquityDeliveryCharges}=require("../lib/trading-charges");
 const c=calculateEquityDeliveryCharges({grossPaise:100000000,exchange:"NSE",side:"SELL"});
 assert.equal(c.sttPaise,100000);
 assert.equal(c.stampDutyPaise,0);
 assert.equal(c.dpChargesPaise,2000);
 assert.equal(c.gstPaise,1273);
 assert.equal(c.totalChargesPaise,108443);
});
test("BSE delivery orders are blocked until exact scrip-group charges are known",()=>{
 const {calculateEquityDeliveryCharges}=require("../lib/trading-charges");
 assert.throws(()=>calculateEquityDeliveryCharges({grossPaise:100000,exchange:"BSE",side:"BUY"}),{status:422});
});

test("NSE intraday BUY includes capped brokerage, exchange, SEBI, stamp duty and GST",()=>{
 const {calculateEquityIntradayCharges}=require("../lib/trading-charges");
 const c=calculateEquityIntradayCharges({grossPaise:100000000,exchange:"NSE",side:"BUY"});
 assert.equal(c.brokeragePaise,2000);
 assert.equal(c.exchangeTransactionPaise,3070);
 assert.equal(c.ipftPaise,0);
 assert.equal(c.sebiPaise,100);
 assert.equal(c.stampDutyPaise,3000);
 assert.equal(c.sttPaise,0);
 assert.equal(c.gstPaise,913);
 assert.equal(c.totalChargesPaise,9083);
 assert.equal(c.totalDebitPaise,100009083);
 assert.equal(c.segment,"EQUITY_INTRADAY");
 assert.equal(c.indicative,true);
});
test("NSE intraday SELL applies 0.025 percent STT and no buy-side stamp duty",()=>{
 const {calculateEquityIntradayCharges}=require("../lib/trading-charges");
 const c=calculateEquityIntradayCharges({grossPaise:100000000,exchange:"NSE",side:"SELL"});
 assert.equal(c.sttPaise,25000);
 assert.equal(c.stampDutyPaise,0);
 assert.equal(c.totalChargesPaise,31083);
 assert.equal(c.netCreditPaise,99968917);
 assert.equal(c.totalDebitPaise,null);
});
test("intraday brokerage is lower of 0.10 percent turnover or Rs 20",()=>{
 const {calculateEquityIntradayCharges}=require("../lib/trading-charges");
 const small=calculateEquityIntradayCharges({grossPaise:100000,exchange:"NSE",side:"BUY"});
 const large=calculateEquityIntradayCharges({grossPaise:100000000,exchange:"NSE",side:"BUY"});
 assert.equal(small.brokeragePaise,100);
 assert.equal(large.brokeragePaise,2000);
});
test("BSE intraday orders fail closed without the applicable scrip-group rate",()=>{
 const {calculateEquityIntradayCharges}=require("../lib/trading-charges");
 assert.throws(()=>calculateEquityIntradayCharges({grossPaise:100000,exchange:"BSE"}),{status:422});
});
test("intraday calculator rejects invalid turnover, side and brokerage cap",()=>{
 const {calculateEquityIntradayCharges}=require("../lib/trading-charges");
 assert.throws(()=>calculateEquityIntradayCharges({grossPaise:0,exchange:"NSE"}),/turnover/);
 assert.throws(()=>calculateEquityIntradayCharges({grossPaise:1000,exchange:"NSE",side:"HOLD"}),/side/);
 assert.throws(()=>calculateEquityIntradayCharges({grossPaise:1000,exchange:"NSE",brokerageCapPaise:-1}),/Brokerage cap/);
});

test("NSE delivery brokerage is flat ₹20 per executed order even on small turnover",()=>{
 const {calculateEquityDeliveryCharges}=require("../lib/trading-charges");
 const c=calculateEquityDeliveryCharges({grossPaise:100000,exchange:"NSE",side:"BUY"});
 assert.equal(c.brokeragePaise,2000);
 assert.equal(c.scheduleVersion,"2026-03-01");
});
test("NSE intraday schedule version tracks the 1 March 2026 transaction schedule",()=>{
 const {calculateEquityIntradayCharges}=require("../lib/trading-charges");
 const c=calculateEquityIntradayCharges({grossPaise:100000,exchange:"NSE",side:"BUY"});
 assert.equal(c.scheduleVersion,"2026-03-01");
});

test("NSE delivery SELL fails closed when minimum charges consume all proceeds",()=>{
 const {calculateEquityDeliveryCharges}=require("../lib/trading-charges");
 assert.throws(()=>calculateEquityDeliveryCharges({grossPaise:1,exchange:"NSE",side:"SELL"}),{status:422});
});
