"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {validateDerivativeContract,normalizeTickSizePaise,normalizeExpiryDate}=require("../lib/derivative-contract");
const now=Date.UTC(2026,10,18,10);
const option=()=>({instrument_key:"NSE_FO|NIFTY26NOV25000CE",trading_symbol:"NIFTY 26 NOV 25000 CE",segment:"NSE_FO",exchange:"NSE",instrument_type:"CE",expiry:"2026-11-26",strike_price:25000,lot_size:65,tick_size:5});
test("validates an option contract and converts lots to units",()=>{
 const result=validateDerivativeContract(option(),{lots:2,pricePaise:1250,now});
 assert.equal(result.quantity,130);assert.equal(result.lotSize,65);assert.equal(result.tickSizePaise,5);assert.equal(result.contractValuePaise,162500);
});
test("accepts valid futures contract metadata",()=>{
 const f={...option(),instrument_key:"NSE_FO|NIFTY26NOVFUT",trading_symbol:"NIFTY FUT",instrument_type:"FUT",strike_price:0};
 assert.equal(validateDerivativeContract(f,{lots:1,pricePaise:2500000,now}).quantity,65);
});
test("rejects exchange/segment mismatches and foreign or empty instrument-key prefixes",()=>{
 for(const patch of [
  {exchange:"NSE",segment:"BSE_FO",instrument_key:"BSE_FO|NIFTYCE"},
  {exchange:"BSE",segment:"NSE_FO",instrument_key:"NSE_FO|SENSEXCE"},
  {exchange:"NSE",segment:"NSE_FO",instrument_key:"BSE_FO|NIFTYCE"},
  {exchange:"BSE",segment:"BSE_FO",instrument_key:"BSE_FO|"}
 ]){
  assert.throws(()=>validateDerivativeContract({...option(),...patch},{lots:1,pricePaise:1250,now}),/exchange, segment and instrument key/);
 }
});
test("rejects non-derivative, wrong segment and unknown types",()=>{
 for(const patch of [{segment:"NSE_EQ"},{segment:"MCX_FO"},{instrument_type:"EQ"}])assert.throws(()=>validateDerivativeContract({...option(),...patch},{lots:1,pricePaise:1250,now}),/Only verified/);
});
test("rejects invalid lot sizes, lot counts and overflow",()=>{
 for(const patch of [{lot_size:0},{lot_size:1.5},{lot_size:1000001}])assert.throws(()=>validateDerivativeContract({...option(),...patch},{lots:1,pricePaise:1250,now}));
 assert.throws(()=>validateDerivativeContract(option(),{lots:0,pricePaise:1250,now}));
 assert.throws(()=>validateDerivativeContract({...option(),lot_size:1000000},{lots:2,pricePaise:1250,now}));
});
test("rejects missing tick and off-tick execution prices",()=>{
 assert.throws(()=>validateDerivativeContract({...option(),tick_size:null},{lots:1,pricePaise:1250,now}),/tick size/);
 assert.throws(()=>validateDerivativeContract(option(),{lots:1,pricePaise:1251,now}),/tick size/);
});
test("rejects expired or malformed contracts using exchange-local expiry cutoff",()=>{
 assert.throws(()=>validateDerivativeContract({...option(),expiry:"2026-11-17"},{lots:1,pricePaise:1250,now}),/Expired/);
 assert.throws(()=>validateDerivativeContract({...option(),expiry:"2026-02-30"},{lots:1,pricePaise:1250,now}));
 const expiryClose=Date.UTC(2026,10,26,10,0);
 assert.equal(validateDerivativeContract(option(),{lots:1,pricePaise:1250,now:expiryClose-1}).quantity,65);
 assert.throws(()=>validateDerivativeContract(option(),{lots:1,pricePaise:1250,now:expiryClose}),/Expired/);
});
test("requires valid option strike and clean futures strike",()=>{
 assert.throws(()=>validateDerivativeContract({...option(),strike_price:0},{lots:1,pricePaise:1250,now}),/strike/);
 assert.throws(()=>validateDerivativeContract({...option(),instrument_type:"FUT",strike_price:25000},{lots:1,pricePaise:1250,now}),/futures contract/);
});
test("converts only exact rupee tick sizes to paise",()=>{
 assert.equal(normalizeTickSizePaise(5),5);assert.equal(normalizeTickSizePaise(0.05),5);assert.equal(normalizeTickSizePaise(10),10);assert.equal(normalizeTickSizePaise(0),null);assert.equal(normalizeTickSizePaise(0.005),null);
});

test("normalizes Upstox BOD millisecond expiry to India-local date",()=>{
 const expiryMs=Date.UTC(2026,10,26,18,29,59);
 assert.equal(normalizeExpiryDate(expiryMs),"2026-11-26");
 const raw={...option(),expiry:expiryMs,tick_size:5};
 assert.equal(validateDerivativeContract(raw,{lots:1,pricePaise:1250,now:Date.UTC(2026,10,18,10)}).expiry,"2026-11-26");
});


test("enforces the expiry-day 15:30 Asia/Kolkata cutoff at the exact millisecond",()=>{
 const expiry=option();
 const cutoff=Date.UTC(2026,10,26,10,0,0,0); // 15:30 IST
 assert.equal(validateDerivativeContract(expiry,{lots:1,pricePaise:1250,now:cutoff-1}).expiry,"2026-11-26");
 assert.throws(()=>validateDerivativeContract(expiry,{lots:1,pricePaise:1250,now:cutoff}),/Expired/);
 assert.throws(()=>validateDerivativeContract(expiry,{lots:1,pricePaise:1250,now:cutoff+1}),/Expired/);
});

test("normalizes expiry timestamps across the India-local midnight boundary",()=>{
 assert.equal(normalizeExpiryDate(Date.UTC(2026,10,26,18,29,59,999)),"2026-11-26");
 assert.equal(normalizeExpiryDate(Date.UTC(2026,10,26,18,30,0,0)),"2026-11-27");
 assert.equal(normalizeExpiryDate(Date.UTC(2026,10,26,18,30,0,1)),"2026-11-27");
});

test("rejects unsafe or non-integral execution values and malformed time inputs",()=>{
 for(const pricePaise of [0,-5,1.5,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>validateDerivativeContract(option(),{lots:1,pricePaise,now}));
 }
 for(const badNow of [-1,1.5,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>validateDerivativeContract(option(),{lots:1,pricePaise:1250,now:badNow}));
 }
});

test("supports both NSE and BSE listed CE and PE contracts with valid tick alignment",()=>{
 for(const [exchange,segment] of [["NSE","NSE_FO"],["BSE","BSE_FO"]]){
  for(const instrument_type of ["CE","PE"]){
   const contract={...option(),exchange,segment,instrument_type,
    instrument_key:segment+"|"+instrument_type,
    trading_symbol:instrument_type+" TEST",tick_size:5};
   assert.equal(validateDerivativeContract(contract,{lots:1,pricePaise:1250,now}).instrumentType,instrument_type);
  }
 }
});
