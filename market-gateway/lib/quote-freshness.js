"use strict";
function quoteAgeMs(tradeTime, now=Date.now()){
  const timestamp=Number(tradeTime);
  if(!Number.isFinite(timestamp)||timestamp<=0||!Number.isFinite(now))return null;
  const age=now-timestamp;
  return Number.isFinite(age)?age:null;
}
function isFreshQuote(tradeTime,maxAgeMs,now=Date.now()){
  const age=quoteAgeMs(tradeTime,now);
  // Provider timestamps must never be ahead of the gateway clock. Keep this
  // strict rule aligned with the V3 stream normalizer and provider contract.
  return age!==null&&Number.isFinite(maxAgeMs)&&maxAgeMs>=0&&age>=0&&age<=maxAgeMs;
}
module.exports={quoteAgeMs,isFreshQuote};
