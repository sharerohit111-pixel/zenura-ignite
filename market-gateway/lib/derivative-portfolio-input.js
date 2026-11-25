"use strict";
const {normalizeExpiryDate}=require("./derivative-contract");

function fail(message){throw Object.assign(new Error(message),{status:409});}
function safeStrikePaise(value){
 const strike=typeof value==="number"?value:Number(value);
 if(!Number.isFinite(strike)||strike<=0)return null;
 const paise=Math.round(strike*100);
 return Number.isSafeInteger(paise)&&paise>0&&Math.abs(strike*100-paise)<1e-7?paise:null;
}
function expiryCutoffMs(expiry){
 const date=normalizeExpiryDate(expiry);
 if(!date)return null;
 const [year,month,day]=date.split("-").map(Number);
 return Date.UTC(year,month-1,day,10,0,0,0);
}
function buildLongOptionPortfolioPositions(rows,instruments){
 if(!Array.isArray(rows)||!Array.isArray(instruments))fail("Derivative portfolio source rows or instrument master are invalid.");
 const master=new Map();
 for(const item of instruments){
  if(item&&typeof item.instrument_key==="string"){
   if(master.has(item.instrument_key))fail("Official instrument master contains a duplicate derivative contract identity.");
   master.set(item.instrument_key,item);
  }
 }
 const seen=new Set();
 return rows.map(p=>{
  if(!p||typeof p.instrument_key!=="string"||seen.has(p.instrument_key)||
     !["CE","PE"].includes(p.instrument_type)||!Number.isSafeInteger(p.net_quantity)||
     p.net_quantity<1||p.net_quantity>1000000||!Number.isSafeInteger(p.average_price_paise)||
     p.average_price_paise<1||!Number.isSafeInteger(p.cost_basis_paise)||p.cost_basis_paise<1)
   fail("Stored long-option position is malformed or duplicated.");
  seen.add(p.instrument_key);
  const item=master.get(p.instrument_key);
  const expiry=normalizeExpiryDate(p.expiry),masterExpiry=normalizeExpiryDate(item&&item.expiry);
  if(!item||item.instrument_type!==p.instrument_type||
     !["NSE_FO","BSE_FO"].includes(item.segment)||
     item.exchange!==p.exchange||item.segment!==p.segment||
     !expiry||expiry!==masterExpiry||
     (p.lot_size!==null&&p.lot_size!==undefined&&p.lot_size!==item.lot_size))
   fail("Stored option position does not match its official contract identity, expiry, exchange or lot size.");
  const strikePaise=safeStrikePaise(item.strike_price);
  if(strikePaise===null)fail("Official option strike is missing or invalid; valuation stopped.");
  return {instrumentKey:p.instrument_key,instrumentType:p.instrument_type,optionType:p.instrument_type,
   expiry,strikePaise,netQuantity:p.net_quantity,averagePricePaise:p.average_price_paise,
   costBasisPaise:p.cost_basis_paise};
 });
}
function validateFuturesPortfolioContracts(rows,instruments){
 if(!Array.isArray(rows)||!Array.isArray(instruments))fail("Futures portfolio source rows or instrument master are invalid.");
 const master=new Map();
 for(const item of instruments){
  if(item&&typeof item.instrument_key==="string"){
   if(master.has(item.instrument_key))fail("Official instrument master contains a duplicate futures contract identity.");
   master.set(item.instrument_key,item);
  }
 }
 const seen=new Set(),result=new Map();
 for(const p of rows){
  if(!p||typeof p.instrument_key!=="string"||seen.has(p.instrument_key)||
     !Number.isSafeInteger(p.net_quantity)||p.net_quantity===0||Math.abs(p.net_quantity)>1000000||
     !Number.isSafeInteger(p.average_price_paise)||p.average_price_paise<1||
     !Number.isSafeInteger(p.lot_size)||p.lot_size<1)
   fail("Stored Futures position is malformed or duplicated.");
  seen.add(p.instrument_key);
  const item=master.get(p.instrument_key),expiry=normalizeExpiryDate(p.expiry);
  if(!item||item.instrument_type!=="FUT"||!["NSE_FO","BSE_FO"].includes(item.segment)||
     item.exchange!==p.exchange||item.segment!==p.segment||
     !expiry||expiry!==normalizeExpiryDate(item.expiry)||item.lot_size!==p.lot_size)
   fail("Stored Futures position does not match its official contract identity, expiry, exchange or lot size.");
  result.set(p.instrument_key,{expiry,expiryCutoffMs:expiryCutoffMs(expiry)});
 }
 return result;
}
module.exports={buildLongOptionPortfolioPositions,validateFuturesPortfolioContracts,expiryCutoffMs,safeStrikePaise};
