"use strict";

const {validateDerivativeContract}=require("./derivative-contract");
const {calculateLongOptionTradeCharges}=require("./trading-charges");
const {evaluateUpstoxRestDerivativeLimit}=require("./upstox-rest-executable-quote");

function assertSafeInteger(value,name,{min=0}={}){
  if(!Number.isSafeInteger(value)||value<min){
    throw new TypeError(`${name} must be a safe integer >= ${min}`);
  }
}

function validateOptionLimitOrder({
  instrument,side,lots,limitPricePaise,availableCashPaise,
  availableLongQuantity=0,reservedCloseQuantity=0,nowMs=Date.now()
}){
  if(!["BUY","SELL"].includes(side))throw new TypeError("Option LIMIT side must be BUY or SELL.");
  if(!instrument||instrument.exchange!=="NSE"||instrument.segment!=="NSE_FO"
     ||!["CE","PE"].includes(instrument.instrument_type)){
    throw Object.assign(new Error("Only verified NSE long CE/PE option LIMIT contracts are enabled."),{status:422});
  }
  const contract=validateDerivativeContract(instrument,{lots,pricePaise:limitPricePaise,now:nowMs});
  assertSafeInteger(nowMs,"nowMs",{min:1});
  const expiryCutoffMs=Date.parse(contract.expiry+"T15:30:00+05:30");
  if(!Number.isSafeInteger(expiryCutoffMs)||nowMs>=expiryCutoffMs){
    throw Object.assign(new Error("Expired option contracts cannot accept LIMIT orders."),{status:422});
  }
  let reservedCashPaise=0,reservedCloseQuantityToSet=0,estimatedCharges=null;
  if(side==="BUY"){
    assertSafeInteger(availableCashPaise,"availableCashPaise");
    const grossPaise=contract.contractValuePaise;
    estimatedCharges=calculateLongOptionTradeCharges({grossPaise,exchange:"NSE",side:"BUY"});
    reservedCashPaise=estimatedCharges.totalDebitPaise;
    if(reservedCashPaise>availableCashPaise){
      throw Object.assign(new Error("Insufficient unreserved virtual cash for option LIMIT reservation."),{status:409});
    }
  }else{
    assertSafeInteger(availableLongQuantity,"availableLongQuantity");
    assertSafeInteger(reservedCloseQuantity,"reservedCloseQuantity");
    const availableToClose=availableLongQuantity-reservedCloseQuantity;
    if(availableToClose<contract.quantity){
      throw Object.assign(new Error("SELL LIMIT can only reserve unreserved quantity from an existing long option position."),{status:409});
    }
    reservedCloseQuantityToSet=contract.quantity;
  }
  return Object.freeze({
    ...contract,side,limitPricePaise,
    reservedCashPaise,reservedCloseQuantity:reservedCloseQuantityToSet,
    estimatedCharges,simulationOnly:true
  });
}

function evaluateOptionLimitQuote(payload,instrument,order,{
  nowMs=Date.now(),maxAgeMs=15000
}={}){
  if(!instrument||instrument.exchange!=="NSE"||instrument.segment!=="NSE_FO"
     ||!["CE","PE"].includes(instrument.instrument_type)
     ||!order||!["BUY","SELL"].includes(order.side)){
    throw new TypeError("A verified NSE option LIMIT order is required for quote evaluation.");
  }
  const result=evaluateUpstoxRestDerivativeLimit(payload,instrument.instrument_key,{
    side:order.side,limitPricePaise:order.limitPricePaise,
    remainingQuantity:order.remainingQuantity,nowMs,maxAgeMs
  });
  if(result.eligible&&result.pricePaise%order.tickSizePaise!==0){
    return Object.freeze({...result,eligible:false,reason:"OFF_TICK_EXECUTABLE_PRICE",fillQuantity:0});
  }
  return result;
}

function allocateOptionLimitReservation({remainingReservationPaise,remainingQuantity,fillQuantity}){
  assertSafeInteger(remainingReservationPaise,"remainingReservationPaise");
  assertSafeInteger(remainingQuantity,"remainingQuantity",{min:1});
  assertSafeInteger(fillQuantity,"fillQuantity",{min:1});
  if(fillQuantity>remainingQuantity)throw new RangeError("fillQuantity exceeds remainingQuantity");
  const allocatedReservationPaise=fillQuantity===remainingQuantity
    ?remainingReservationPaise
    :Number((BigInt(remainingReservationPaise)*BigInt(fillQuantity))/BigInt(remainingQuantity));
  return Object.freeze({
    allocatedReservationPaise,
    remainingReservationPaise:remainingReservationPaise-allocatedReservationPaise,
    remainingQuantity:remainingQuantity-fillQuantity
  });
}

module.exports={validateOptionLimitOrder,evaluateOptionLimitQuote,allocateOptionLimitReservation};
