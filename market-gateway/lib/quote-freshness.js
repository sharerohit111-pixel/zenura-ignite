"use strict";
function quoteAgeMs(tradeTime, now=Date.now()){
  const timestamp=Number(tradeTime);
  if(!Number.isFinite(timestamp)||timestamp<=0||!Number.isFinite(now))return null;
  const age=now-timestamp;
  return Number.isFinite(age)?age:null;
}
function isFreshQuote(tradeTime,maxAgeMs,now=Date.now(),maxFutureSkewMs=5000){
  const age=quoteAgeMs(tradeTime,now);
  return age!==null&&Number.isFinite(maxAgeMs)&&maxAgeMs>=0&&age>=-maxFutureSkewMs&&age<=maxAgeMs;
}
module.exports={quoteAgeMs,isFreshQuote};
