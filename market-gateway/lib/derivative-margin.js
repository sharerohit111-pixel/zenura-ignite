"use strict";
const MAX_MARGIN_SNAPSHOT_AGE_MS=30_000;
function calculateDerivativeMargin({contract,side,pricePaise,availableCashPaise,marginSnapshot,now=Date.now()}){
 const fail=message=>{throw Object.assign(new Error(message),{status:400});};
 if(!contract||typeof contract!=="object"||typeof contract.instrumentKey!=="string"||!contract.instrumentKey)fail("A validated derivative contract is required.");
 if(!["BUY","SELL"].includes(side))fail("Derivative side must be BUY or SELL.");
 if(!Number.isSafeInteger(contract.quantity)||contract.quantity<1||!Number.isSafeInteger(contract.contractValuePaise)||contract.contractValuePaise<1)fail("Validated contract quantity and value are required.");
 if(!Number.isSafeInteger(pricePaise)||pricePaise<1)fail("A valid execution price is required.");
 if(!Number.isSafeInteger(availableCashPaise)||availableCashPaise<0)fail("Available virtual cash is invalid.");
 if(!Number.isSafeInteger(now)||now<0)fail("Current time is invalid.");
 let requiredMarginPaise,marginSource;
 const isLongOption=side==="BUY"&&["CE","PE"].includes(contract.instrumentType);
 if(isLongOption){
  requiredMarginPaise=pricePaise*contract.quantity;
  marginSource="option_premium_debit";
 }else{
  if(!marginSnapshot||typeof marginSnapshot!=="object"||marginSnapshot.instrumentKey!==contract.instrumentKey)fail("A matching broker-calculated margin snapshot is required for futures and short options.");
  if(!Number.isSafeInteger(marginSnapshot.requiredMarginPaise)||marginSnapshot.requiredMarginPaise<1)fail("Broker margin snapshot is missing a valid required margin.");
  if(!Number.isSafeInteger(marginSnapshot.observedAtMs)||marginSnapshot.observedAtMs>now||now-marginSnapshot.observedAtMs>MAX_MARGIN_SNAPSHOT_AGE_MS)fail("Broker margin snapshot is stale or has an invalid timestamp.");
  if(typeof marginSnapshot.source!=="string"||!marginSnapshot.source.trim())fail("Margin snapshot source is required.");
  requiredMarginPaise=marginSnapshot.requiredMarginPaise;
  marginSource="broker_snapshot";
 }
 if(!Number.isSafeInteger(requiredMarginPaise)||requiredMarginPaise<1)fail("Required margin exceeds supported calculation limits.");
 const shortfallPaise=Math.max(requiredMarginPaise-availableCashPaise,0);
 return {requiredMarginPaise,availableCashPaise,shortfallPaise,canPlacePaperOrder:shortfallPaise===0,marginSource,marginSnapshotAgeMs:marginSource==="broker_snapshot"?now-marginSnapshot.observedAtMs:null,simulationOnly:true};
}
module.exports={calculateDerivativeMargin,MAX_MARGIN_SNAPSHOT_AGE_MS};
