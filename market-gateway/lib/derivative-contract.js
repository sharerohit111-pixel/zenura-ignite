"use strict";
const DERIVATIVE_SEGMENTS=new Set(["NSE_FO","BSE_FO"]);
const DERIVATIVE_TYPES=new Set(["FUT","CE","PE"]);
function normalizeTickSizePaise(value){
 if(typeof value!=="number"||!Number.isFinite(value)||value<=0)return null;
 // Upstox BOD JSON expresses tick_size in paise (e.g. 5); accept
 // legacy decimal-rupee fixtures (e.g. 0.05) as well.
 const paise=value<1?value*100:value;
 return Number.isSafeInteger(Math.round(paise))&&Math.abs(paise-Math.round(paise))<1e-7&&paise>0?Math.round(paise):null;
}
function normalizeExpiryDate(value){
 if(typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)){
  const d=new Date(value+"T00:00:00.000Z");
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value?value:null;
 }
 if(typeof value==="number"&&Number.isSafeInteger(value)&&value>0){
  const d=new Date(value);
  if(!Number.isFinite(d.getTime()))return null;
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return p.year+"-"+p.month+"-"+p.day;
 }
 return null;
}
function validateDerivativeContract(instrument,{lots,pricePaise,now=Date.now()}={}){
 const fail=message=>{throw Object.assign(new Error(message),{status:400});};
 if(!instrument||typeof instrument!=="object")fail("A verified derivative contract is required.");
 if(!DERIVATIVE_SEGMENTS.has(instrument.segment)||!DERIVATIVE_TYPES.has(instrument.instrument_type))fail("Only verified NSE/BSE futures and options contracts are supported.");
 if(typeof instrument.instrument_key!=="string"||!instrument.instrument_key||typeof instrument.trading_symbol!=="string"||!instrument.trading_symbol||!["NSE","BSE"].includes(instrument.exchange))fail("Derivative contract identity is incomplete.");
 // Never accept a cross-exchange segment/key combination: all three identity
 // fields must agree before the contract can reach an order or reservation path.
 const expectedSegment=instrument.exchange+"_FO";
 if(instrument.segment!==expectedSegment||!instrument.instrument_key.startsWith(expectedSegment+"|")||instrument.instrument_key.length<=expectedSegment.length+1)
  fail("Derivative exchange, segment and instrument key do not identify the same contract market.");
 const lotSize=instrument.lot_size;
 if(!Number.isSafeInteger(lotSize)||lotSize<1||lotSize>1000000)fail("Contract lot size is missing or invalid in the official instrument master.");
 if(!Number.isSafeInteger(lots)||lots<1||lots>10000)fail("Lots must be a whole number between 1 and 10,000.");
 const quantity=lots*lotSize;
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)fail("Contract quantity exceeds supported limits.");
 const tickSizePaise=normalizeTickSizePaise(instrument.tick_size);
 if(tickSizePaise===null)fail("Contract tick size is missing or invalid in the official instrument master.");
 if(!Number.isSafeInteger(pricePaise)||pricePaise<1||pricePaise%tickSizePaise!==0)fail("Execution price is invalid or does not align with the contract tick size.");
 const expiry=normalizeExpiryDate(instrument.expiry);
 if(!expiry)fail("Contract expiry is missing or invalid.");
 if(!Number.isSafeInteger(now)||now<0)fail("Current time is invalid.");
 const [year,month,day]=expiry.split("-").map(Number);
 const expiryCutoffUtc=Date.UTC(year,month-1,day,15,30)-330*60*1000;
 if(now>=expiryCutoffUtc)fail("Expired derivative contracts cannot be traded.");
 if(instrument.instrument_type==="CE"||instrument.instrument_type==="PE"){
  if(typeof instrument.strike_price!=="number"||!Number.isFinite(instrument.strike_price)||instrument.strike_price<=0)fail("Option strike price is missing or invalid.");
 }else if(instrument.instrument_type==="FUT"&&instrument.strike_price!==undefined&&instrument.strike_price!==null&&Number(instrument.strike_price)!==0){
  fail("A futures contract must not contain an option strike price.");
 }
 const contractValuePaise=pricePaise*quantity;
 if(!Number.isSafeInteger(contractValuePaise)||contractValuePaise<=0)fail("Derivative contract value exceeds supported calculation limits.");
 return {instrumentKey:instrument.instrument_key,segment:instrument.segment,instrumentType:instrument.instrument_type,exchange:instrument.exchange,expiry,lotSize,lots,quantity,tickSizePaise,pricePaise,contractValuePaise};
}
module.exports={validateDerivativeContract,normalizeTickSizePaise,normalizeExpiryDate};
