"use strict";
function isFreshMarketFeedQuote(quote,{now=Date.now(),maxAgeMs=15000}={}){
 if(!quote||typeof quote!=="object")return false;
 const ltp=Number(quote.ltp),tradeTime=Number(quote.ltt);
 if(!Number.isFinite(ltp)||ltp<=0||!Number.isSafeInteger(Math.round(ltp*100))||Math.round(ltp*100)<1)return false;
 if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<0)return false;
 if(!Number.isSafeInteger(tradeTime)||tradeTime<=0)return false;
 const age=now-tradeTime;
 return age>=0&&age<=maxAgeMs;
}
function filterFreshMarketFeeds(payload,instrumentKeys,{now=Date.now(),maxAgeMs=15000}={}){
 if(!payload||typeof payload!=="object"||!payload.feeds||typeof payload.feeds!=="object"||!Array.isArray(instrumentKeys))return null;
 const allowed=new Set(instrumentKeys);
 const feeds={};
 for(const [key,feed] of Object.entries(payload.feeds)){
  if(!allowed.has(key)||!feed||typeof feed!=="object")continue;
  const quote=feed.ltpc||feed.fullFeed?.marketFF?.ltpc||feed.fullFeed?.indexFF?.ltpc;
  if(isFreshMarketFeedQuote(quote,{now,maxAgeMs}))feeds[key]=feed;
 }
 return Object.keys(feeds).length?{...payload,feeds}:null;
}
module.exports={isFreshMarketFeedQuote,filterFreshMarketFeeds};
