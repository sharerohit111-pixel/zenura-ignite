"use strict";

// Indicative, non-posting expiry simulation for long NSE index options only.
// Physical settlement and unverified settlement-price sources are deliberately blocked.
function simulateLongIndexOptionExpiry({
  position,contract,settlementPricePaise,settlementDate,
  settlementSource,settlementSourceSha256,settlementTimestampMs,verifiedAtMs,nowMs=Date.now()
}){
  const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status});};
  const safe=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
  if(!position||!contract||typeof position!=="object"||typeof contract!=="object")fail("Long option position and verified contract are required.",400);
  if(contract.exchange!=="NSE"||contract.segment!=="NSE_FO"||!["CE","PE"].includes(contract.instrumentType))fail("Only NSE CE/PE option contracts are supported.");
  if(contract.underlyingType!=="INDEX"||contract.settlementType!=="CASH_SETTLED")fail("Only explicitly verified cash-settled NSE index options can be simulated; physical/unknown settlement is blocked.");
  if(position.instrumentKey!==contract.instrumentKey||position.instrumentType!==contract.instrumentType||position.expiry!==contract.expiryDate)fail("Position and expiry contract metadata do not match.",409);
  if(!safe(position.netQuantity,1)||position.netQuantity>1000000||!safe(position.costBasisPaise,1))fail("Only a valid existing long option position with fee-inclusive cost basis can be simulated.",409);
  if(!safe(contract.strikePricePaise,1)||!safe(settlementPricePaise,0))fail("Strike and official settlement prices must be integer paise.");
  if(!safe(nowMs,1)||!safe(verifiedAtMs,1)||verifiedAtMs>nowMs||!safe(settlementTimestampMs,1)||settlementTimestampMs>verifiedAtMs)fail("Settlement price verification timestamp is invalid.");
  if(settlementDate!==contract.expiryDate)fail("Settlement price must belong to the contract expiry date.");
  const sourceDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(settlementTimestampMs));
  if(sourceDate!==settlementDate)fail("Settlement price timestamp does not belong to the contract expiry date.");
  if(typeof settlementSource!=="string"||!/^https:\/\/(?:[a-z0-9-]+\.)*nseindia\.com\//i.test(settlementSource))fail("An official NSE settlement-price source is required.");
  if(typeof settlementSourceSha256!=="string"||! /^[a-f0-9]{64}$/.test(settlementSourceSha256))fail("A verified SHA-256 digest for the settlement source is required.");
  const intrinsic=contract.instrumentType==="CE"
    ?Math.max(settlementPricePaise-contract.strikePricePaise,0)
    :Math.max(contract.strikePricePaise-settlementPricePaise,0);
  const payout=intrinsic*position.netQuantity;
  if(!safe(payout,0)||!safe(payout-position.costBasisPaise,-Number.MAX_SAFE_INTEGER))fail("Expiry simulation exceeds safe integer limits.");
  return Object.freeze({
    instrumentKey:contract.instrumentKey,instrumentType:contract.instrumentType,
    settlementType:"CASH_SETTLED",quantity:position.netQuantity,
    settlementPricePaise,strikePricePaise:contract.strikePricePaise,
    intrinsicValuePerUnitPaise:intrinsic,grossSettlementPayoutPaise:payout,
    feeInclusiveEntryCostBasisPaise:position.costBasisPaise,
    grossPnlBeforeSettlementChargesPaise:payout-position.costBasisPaise,
    settlementChargesPaise:null,netRealizedPnlPaise:null,
    settlementSource,settlementSourceSha256,settlementTimestampMs,verifiedAtMs,settlementDate,
    simulationOnly:true,ledgerPostingAllowed:false,
    note:"Indicative payoff only. No ledger posting; verify the applicable settlement charge schedule before calculating net realized P&L."
  });
}

module.exports={simulateLongIndexOptionExpiry};
