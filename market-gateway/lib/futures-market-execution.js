"use strict";

function fail(message){
  throw Object.assign(new Error(message),{status:409});
}

function resolveFuturesMarketExecution({
  quote,side,quantity,tickSizePaise,nowMs=Date.now(),maxAgeMs=15000
}={}){
  if(!quote||typeof quote!=="object"||Array.isArray(quote)
     ||!["BUY","SELL"].includes(side)
     ||!Number.isSafeInteger(quantity)||quantity<1
     ||!Number.isSafeInteger(tickSizePaise)||tickSizePaise<1
     ||!Number.isSafeInteger(nowMs)||nowMs<1
     ||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1){
    fail("Invalid Futures MARKET execution request.");
  }
  const timestampMs=quote.timestampMs;
  const ageMs=nowMs-timestampMs;
  if(!Number.isSafeInteger(timestampMs)||timestampMs<1||ageMs<0||ageMs>maxAgeMs){
    fail("A fresh, non-future Futures order-book snapshot is required.");
  }
  const bid=quote.bidPricePaise,ask=quote.askPricePaise;
  const bidQuantity=quote.bidQuantity,askQuantity=quote.askQuantity;
  if(!Number.isSafeInteger(bid)||bid<1||!Number.isSafeInteger(ask)||ask<1
     ||!Number.isSafeInteger(bidQuantity)||bidQuantity<1
     ||!Number.isSafeInteger(askQuantity)||askQuantity<1){
    fail("A complete executable Futures bid/ask book is required; LTP fallback is disabled.");
  }
  if(bid>ask)fail("The Futures order book is crossed; MARKET execution was rejected.");
  const pricePaise=side==="BUY"?ask:bid;
  const availableQuantity=side==="BUY"?askQuantity:bidQuantity;
  if(pricePaise%tickSizePaise!==0)
    fail("The executable Futures price does not match the official contract tick size.");
  if(availableQuantity<quantity)
    fail("Displayed Futures depth is insufficient to fully simulate this MARKET order.");
  const grossPaise=pricePaise*quantity;
  if(!Number.isSafeInteger(grossPaise)||grossPaise<1)
    fail("Futures MARKET turnover exceeds supported calculation limits.");
  return Object.freeze({
    side,pricePaise,quantity,availableQuantity,grossPaise,
    quoteTimestampMs:timestampMs,quoteAgeMs:ageMs,
    executionPolicy:"BEST_ASK_FOR_BUY_BEST_BID_FOR_SELL",
    simulationOnly:true
  });
}

module.exports={resolveFuturesMarketExecution};
