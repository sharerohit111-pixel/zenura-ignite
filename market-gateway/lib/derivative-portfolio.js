"use strict";
const MAX_QUOTE_AGE_MS=15_000,MAX_MARGIN_AGE_MS=30_000;
const AUTHORITATIVE_MARGIN_SOURCE="upstox_v2_charges_margin";
function expiryCutoff(expiry){
 if(typeof expiry!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(expiry))return NaN;
 const parts=expiry.split("-").map(Number);
 const date=new Date(Date.UTC(parts[0],parts[1]-1,parts[2],10,0,0,0));
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===expiry?date.getTime():NaN;
}
function calculateDerivativePortfolio({positions,quotes,marginSnapshots=[],now=Date.now(),maxQuoteAgeMs=MAX_QUOTE_AGE_MS,maxMarginAgeMs=MAX_MARGIN_AGE_MS}){
 const fail=message=>{throw Object.assign(new Error(message),{status:409});};
 if(!Array.isArray(positions)||!Array.isArray(quotes)||!Array.isArray(marginSnapshots)||!Number.isSafeInteger(now)||now<0)fail("Derivative portfolio inputs are invalid.");
 if(!Number.isSafeInteger(maxQuoteAgeMs)||maxQuoteAgeMs<0||!Number.isSafeInteger(maxMarginAgeMs)||maxMarginAgeMs<0)fail("Portfolio freshness limits are invalid.");
 const quoteByKey=new Map();
 for(const q of quotes){
  if(!q||typeof q.instrumentKey!=="string"||quoteByKey.has(q.instrumentKey)||!Number.isSafeInteger(q.pricePaise)||q.pricePaise<1||!Number.isSafeInteger(q.observedAtMs)||q.observedAtMs>now||now-q.observedAtMs>maxQuoteAgeMs)fail("Missing, duplicate, invalid or stale derivative quote.");
  quoteByKey.set(q.instrumentKey,q);
 }
 const marginByKey=new Map();
 for(const m of marginSnapshots){
  if(!m||typeof m.instrumentKey!=="string"||marginByKey.has(m.instrumentKey)||!Number.isSafeInteger(m.requiredMarginPaise)||m.requiredMarginPaise<1||!Number.isSafeInteger(m.observedAtMs)||m.observedAtMs>now||now-m.observedAtMs>maxMarginAgeMs||m.source!==AUTHORITATIVE_MARGIN_SOURCE)fail("Invalid, duplicate, stale or unverified derivative margin snapshot provenance.");
  marginByKey.set(m.instrumentKey,m);
 }
 const seen=new Set();let marketValuePaise=0,unrealizedPnlPaise=0,reservedMarginPaise=0;
 const valued=[];
 for(const p of positions){
  if(!p||typeof p.instrumentKey!=="string"||seen.has(p.instrumentKey)||!["FUT","CE","PE"].includes(p.instrumentType)||!Number.isSafeInteger(p.netQuantity)||p.netQuantity===0||Math.abs(p.netQuantity)>1000000||!Number.isSafeInteger(p.averagePricePaise)||p.averagePricePaise<1)fail("Derivative position is malformed or duplicated.");
  const expiryMs=expiryCutoff(p.expiry);
  if(!Number.isFinite(expiryMs))fail("Derivative position requires a valid contract expiry before valuation.");
  if(now>=expiryMs)fail("Expired derivative positions cannot be valued from stale or synthetic marks.");
  if(p.optionType!==undefined&&p.optionType!==p.instrumentType)fail("Derivative position CE/PE identity does not match its contract type.");
  seen.add(p.instrumentKey);
  const q=quoteByKey.get(p.instrumentKey);if(!q)fail("A fresh quote is required for every open derivative position.");
  if((q.expiry!==undefined&&q.expiry!==p.expiry)||(q.instrumentType!==undefined&&q.instrumentType!==p.instrumentType)||
     (q.optionType!==undefined&&q.optionType!==(p.optionType||p.instrumentType))||
     (q.strikePaise!==undefined&&q.strikePaise!==p.strikePaise)||(q.underlying!==undefined&&q.underlying!==p.underlying))
   fail("Derivative quote contract identity does not match the open position.");
  const signedValue=q.pricePaise*p.netQuantity;
  const costBasisPaise=p.costBasisPaise===undefined
   ?Math.abs(p.netQuantity)*p.averagePricePaise:p.costBasisPaise;
  if(!Number.isSafeInteger(costBasisPaise)||costBasisPaise<0||
     (p.netQuantity>0&&costBasisPaise<1)||
     (p.netQuantity>0&&Math.round(costBasisPaise/p.netQuantity)!==p.averagePricePaise))fail("Derivative position cost basis is invalid or inconsistent with its average price.");
  const pnl=p.netQuantity>0&&["CE","PE"].includes(p.instrumentType)
   ?signedValue-costBasisPaise
   :(q.pricePaise-p.averagePricePaise)*p.netQuantity;
  if(!Number.isSafeInteger(signedValue)||!Number.isSafeInteger(pnl))fail("Derivative portfolio valuation exceeds safe calculation limits.");
  let requiredMargin=0,marginAgeMs=null;
  if(p.instrumentType==="FUT"||p.netQuantity<0){
   const m=marginByKey.get(p.instrumentKey);if(!m)fail("A fresh broker margin snapshot is required for every futures or short-option position.");
   requiredMargin=m.requiredMarginPaise;marginAgeMs=now-m.observedAtMs;
  }
  marketValuePaise+=p.instrumentType==="FUT"?0:signedValue;
  unrealizedPnlPaise+=pnl;reservedMarginPaise+=requiredMargin;
  if(!Number.isSafeInteger(marketValuePaise)||!Number.isSafeInteger(unrealizedPnlPaise)||!Number.isSafeInteger(reservedMarginPaise))fail("Derivative portfolio totals exceed safe calculation limits.");
  valued.push({instrumentKey:p.instrumentKey,instrumentType:p.instrumentType,netQuantity:p.netQuantity,averagePricePaise:p.averagePricePaise,costBasisPaise,marketPricePaise:q.pricePaise,marketValuePaise:p.instrumentType==="FUT"?0:signedValue,unrealizedPnlPaise:pnl,requiredMarginPaise:requiredMargin,quoteAgeMs:now-q.observedAtMs,marginAgeMs});
 }
 return {positions:valued,marketValuePaise,unrealizedPnlPaise,reservedMarginPaise,valuationStatus:"fresh",simulationOnly:true,includesEntryCharges:true,excludesEstimatedExitCharges:true};
}
module.exports={calculateDerivativePortfolio,MAX_QUOTE_AGE_MS,MAX_MARGIN_AGE_MS,AUTHORITATIVE_MARGIN_SOURCE};
