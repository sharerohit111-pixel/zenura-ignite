"use strict";

const DERIVATIVE_SEGMENTS=new Set(["NSE_FO","BSE_FO"]);
const DERIVATIVE_TYPES=new Set(["FUT","CE","PE"]);
function toPaiseFromRupees(value){
 if(typeof value!=="number"||!Number.isFinite(value)||value<=0)return null;
 const paise=Math.round(value*100);
 return Number.isSafeInteger(paise)&&paise>0&&Math.abs(value*100-paise)<1e-7?paise:null;
}
function validateDerivativeContract(instrument,{lots,pricePaise,now=Date.now()}={}){
 const fail=message=>{throw Object.assign(new Error(message),{status:400});};
 if(!instrument||typeof instrument!=="object")fail("A verified derivative contract is required.");
 if(!DERIVATIVE_SEGMENTS.has(instrument.segment)||!DERIVATIVE_TYPES.has(instrument.instrument_type))fail("Only verified NSE/BSE futures and options contracts are supported.");
 if(typeof instrument.instrument_key!=="string"||!instrument.instrument_key||typeof instrument.trading_symbol!=="string"||!instrument.trading_symbol)fail("Derivative contract identity is incomplete.");
 const lotSize=instrument.lot_size;
 if(!Number.isSafeInteger(lotSize)||lotSize<1||lotSize>1000000)fail("Contract lot size is missing or invalid in the official instrument master.");
 if(!Number.isSafeInteger(lots)||lots<1||lots>10000)fail("Lots must be a whole number between 1 and 10,000.");
 const quantity=lots*lotSize;
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)fail("Contract quantity exceeds supported limits.");
 const tickSizePaise=toPaiseFromRupees(instrument.tick_size);
 if(tickSizePaise===null)fail("Contract tick size is missing or invalid in the official instrument master.");
 if(!Number.isSafeInteger(pricePaise)||pricePaise<1||pricePaise%tickSizePaise!==0)fail("Execution price is invalid or does not align with the contract tick size.");
 if(typeof instrument.expiry!=="string"||!/^\\d{4}-\\d{2}-\\d{2}$/.test(instrument.expiry))fail("Contract expiry is missing or invalid.");
 const expiry=new Date(instrument.expiry+"T23:59:59.999Z");
 if(!Number.isFinite(expiry.getTime())||expiry.toISOString().slice(0,10)!==instrument.expiry)fail("Contract expiry is not a valid calendar date.");
 if(!Number.isSafeInteger(now)||now<0)fail("Current time is invalid.");
 if(expiry.getTime()<now)fail("Expired derivative contracts cannot be traded.");
 if(instrument.instrument_type==="CE"||instrument.instrument_type==="PE"){
  if(typeof instrument.strike_price!=="number"||!Number.isFinite(instrument.strike_price)||instrument.strike_price<=0)fail("Option strike price is missing or invalid.");
 }else if(instrument.instrument_type==="FUT"&&instrument.strike_price!==undefined&&instrument.strike_price!==null&&Number(instrument.strike_price)!==0){
  fail("A futures contract must not contain an option strike price.");
 }
 return {instrumentKey:instrument.instrument_key,segment:instrument.segment,instrumentType:instrument.instrument_type,exchange:instrument.exchange,expiry:instrument.expiry,lotSize,lots,quantity,tickSizePaise,pricePaise,contractValuePaise:pricePaise*quantity};
}
module.exports={validateDerivativeContract,toPaiseFromRupees};
