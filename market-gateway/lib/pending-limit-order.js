"use strict";

const MAX_ORDER_QUANTITY = 1000000;
const DEFAULT_MAX_QUOTE_AGE_MS = 15000;

function notEligible(reason) {
  return {eligible:false,reason};
}

function evaluatePendingLimitOrder({order,quote,nowMs=Date.now(),maxQuoteAgeMs=DEFAULT_MAX_QUOTE_AGE_MS}={}) {
  if(!order||typeof order!=="object"||Array.isArray(order)||
     order.orderType!=="LIMIT"||order.status!=="PENDING"||order.simulationOnly!==true||
     typeof order.instrumentKey!=="string"||!order.instrumentKey||
     !["BUY","SELL"].includes(order.side)||
     !Number.isSafeInteger(order.quantity)||order.quantity<1||order.quantity>MAX_ORDER_QUANTITY||
     !Number.isSafeInteger(order.limitPricePaise)||order.limitPricePaise<1) {
    throw Object.assign(new Error("Malformed pending paper limit order."),{status:409});
  }
  if(!Number.isSafeInteger(nowMs)||nowMs<1||
     !Number.isSafeInteger(maxQuoteAgeMs)||maxQuoteAgeMs<1) {
    throw Object.assign(new Error("Invalid limit-order quote evaluation clock."),{status:500});
  }
  if(!quote||typeof quote!=="object"||Array.isArray(quote)||
     !Number.isSafeInteger(quote.pricePaise)||quote.pricePaise<1||
     !Number.isSafeInteger(quote.timestampMs)||quote.timestampMs<1) {
    return notEligible("INVALID_QUOTE");
  }
  if(quote.timestampMs>nowMs) return notEligible("FUTURE_QUOTE");
  const ageMs=nowMs-quote.timestampMs;
  if(ageMs>maxQuoteAgeMs) return notEligible("STALE_QUOTE");
  const priceReached=order.side==="BUY"
    ? quote.pricePaise<=order.limitPricePaise
    : quote.pricePaise>=order.limitPricePaise;
  if(!priceReached) return notEligible("LIMIT_NOT_REACHED");
  return {
    eligible:true,
    executionPricePaise:quote.pricePaise,
    quoteTimestampMs:quote.timestampMs,
    quoteAgeMs:ageMs
  };
}

module.exports={evaluatePendingLimitOrder,DEFAULT_MAX_QUOTE_AGE_MS};
