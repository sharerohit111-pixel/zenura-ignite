"use strict";
const {isFreshQuote,quoteAgeMs}=require("./quote-freshness");
function normalizeProviderQuote(entry,instrumentKey,{now=Date.now(),maxAgeMs=15000}={}){
  if(!entry||typeof entry!=="object"||entry.instrument_token!==instrumentKey)
    throw Object.assign(new Error("Provider quote does not match the requested instrument."),{status:409});
  const ltp=Number(entry.last_price),tradeTime=Number(entry.last_trade_time);
  const ageMs=quoteAgeMs(tradeTime,now);
  if(!Number.isFinite(ltp)||ltp<=0||!isFreshQuote(tradeTime,maxAgeMs,now))
    throw Object.assign(new Error("No sufficiently fresh provider quote is available. Paper order rejected."),{status:409,quoteAgeMs:ageMs});
  const pricePaise=Math.round(ltp*100);
  if(!Number.isSafeInteger(pricePaise)||pricePaise<1)
    throw Object.assign(new Error("Provider quote exceeds supported price limits."),{status:409});
  return {pricePaise,tradeTimeMs:tradeTime,quoteAgeMs:ageMs};
}
module.exports={normalizeProviderQuote};
