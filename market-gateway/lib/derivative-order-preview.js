"use strict";

const {validateDerivativeContract}=require("./derivative-contract");
const {calculateDerivativeMargin}=require("./derivative-margin");
const {applyDerivativeFill}=require("./derivative-position");
const {makeOrderFingerprint}=require("./order-idempotency");

const MAX_QUOTE_AGE_MS=15_000;

/**
 * Builds a server-side, preview-only derivative order plan.
 * All account balances, quotes, instruments and margin snapshots must be
 * loaded/verified by trusted server code; never accept them from the client.
 * This helper deliberately does not persist, reserve margin or execute orders.
 */
function buildDerivativeOrderPreview({
  instrument,lots,side,quote,marginSnapshot,availableCashPaise,
  position={netQuantity:0,averagePricePaise:0},now=Date.now()
}){
  const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
  if(!Number.isSafeInteger(now)||now<0)fail("Current time is invalid.",400);
  if(!quote||quote.instrumentKey!==instrument?.instrument_key||
     !Number.isSafeInteger(quote.pricePaise)||quote.pricePaise<1||
     !Number.isSafeInteger(quote.observedAtMs)||quote.observedAtMs>now||
     now-quote.observedAtMs>MAX_QUOTE_AGE_MS)
    fail("A matching fresh market quote is required. Preview rejected.");
  const contract=validateDerivativeContract(instrument,{lots,pricePaise:quote.pricePaise,now});
  const margin=calculateDerivativeMargin({
    contract,side,pricePaise:quote.pricePaise,availableCashPaise,
    marginSnapshot,now
  });
  if(!margin.canPlacePaperOrder)fail("Insufficient available virtual cash or margin.",409);
  const fill=applyDerivativeFill({
    instrumentType:contract.instrumentType,side,quantity:contract.quantity,
    pricePaise:quote.pricePaise,position,now
  });
  const requestFingerprint=makeOrderFingerprint({
    instrumentKey:contract.instrumentKey,side,quantity:contract.quantity
  });
  return {
    status:"PREVIEW_ONLY",
    orderType:"MARKET",
    contract,
    quote:{pricePaise:quote.pricePaise,observedAtMs:quote.observedAtMs,ageMs:now-quote.observedAtMs},
    margin,
    projectedPosition:{
      netQuantity:fill.netQuantity,
      averagePricePaise:fill.averagePricePaise,
      realizedPnlPaise:fill.realizedPnlPaise,
      positionStatus:fill.positionStatus
    },
    projectedCashDeltaPaise:fill.cashDeltaPaise,
    requestFingerprint,
    simulationOnly:true,
    excludesCharges:true,
    executionEnabled:false,
    persisted:false
  };
}

module.exports={buildDerivativeOrderPreview,MAX_QUOTE_AGE_MS};
