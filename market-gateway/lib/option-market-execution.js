"use strict";

const {extractUpstoxRestExecutableQuote}=require("./upstox-rest-executable-quote");
const {normalizeTickSizePaise}=require("./derivative-contract");

function resolveNseOptionMarketExecution(payload,instrument,{
  side,quantity,nowMs=Date.now(),maxAgeMs=15000
}={}){
  if(!instrument||instrument.exchange!=="NSE"||instrument.segment!=="NSE_FO"
     ||![ "CE","PE" ].includes(instrument.instrument_type)
     ||![ "BUY","SELL" ].includes(side)
     ||!Number.isSafeInteger(quantity)||quantity<1
     ||!Number.isSafeInteger(instrument.lot_size)||instrument.lot_size<1
     ||quantity%instrument.lot_size!==0){
    throw Object.assign(new Error("Only whole-lot NSE long CE/PE MARKET orders are supported."),{status:422});
  }
  const quote=extractUpstoxRestExecutableQuote(payload,instrument.instrument_key,{nowMs,maxAgeMs});
  const pricePaise=side==="BUY"?quote.askPricePaise:quote.bidPricePaise;
  const availableQuantity=side==="BUY"?quote.askQuantity:quote.bidQuantity;
  if(!Number.isSafeInteger(pricePaise)||pricePaise<1||!Number.isSafeInteger(availableQuantity)
     ||availableQuantity<quantity){
    throw Object.assign(new Error("Insufficient fresh executable NSE option depth for the full MARKET quantity."),{status:409});
  }
  const tickSizePaise=normalizeTickSizePaise(instrument.tick_size);
  if(!tickSizePaise||pricePaise%tickSizePaise!==0){
    throw Object.assign(new Error("Executable NSE option price is missing or off tick."),{status:409});
  }
  return Object.freeze({
    pricePaise,quoteTimestampMs:quote.timestampMs,
    quoteAgeMs:quote.ageMs,availableQuantity,side
  });
}

module.exports={resolveNseOptionMarketExecution};
