(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.ZenuraLiveQuote=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  "use strict";
  function extractFreshQuote(feed,{now=Date.now(),maxAgeMs=15000,maxFutureSkewMs=5000}={}){
    if(!feed||typeof feed!=="object"||!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<0||!Number.isSafeInteger(maxFutureSkewMs)||maxFutureSkewMs<0)return null;
    const quote=feed.ltpc||feed.fullFeed?.marketFF?.ltpc||feed.fullFeed?.indexFF?.ltpc;
    if(!quote||typeof quote!=="object")return null;
    const ltp=Number(quote.ltp),tradeTimeMs=Number(quote.ltt),pricePaise=Math.round(ltp*100);
    if(!Number.isFinite(ltp)||ltp<=0||!Number.isSafeInteger(pricePaise)||pricePaise<1||!Number.isSafeInteger(tradeTimeMs)||tradeTimeMs<=0)return null;
    const ageMs=now-tradeTimeMs;
    if(ageMs>maxAgeMs||ageMs< -maxFutureSkewMs)return null;
    return {ltp,pricePaise,tradeTimeMs,quoteAgeMs:ageMs};
  }
  return {extractFreshQuote};
});
