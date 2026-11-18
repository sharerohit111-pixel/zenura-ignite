"use strict";
const WATCHLIST_NAMES=Object.freeze(["My Stocks","Banking","NIFTY","F&O"]);
function normalizeWatchlists(data){
  const source=data&&data.watchlists&&typeof data.watchlists==="object"?data.watchlists:{};
  const result={};
  for(const name of WATCHLIST_NAMES){
    const keys=Array.isArray(source[name])?source[name]:(name==="My Stocks"&&Array.isArray(data?.instrumentKeys)?data.instrumentKeys:[]);
    result[name]=[...new Set(keys.filter(k=>typeof k==="string"))].slice(0,50);
  }
  return result;
}
module.exports={WATCHLIST_NAMES,normalizeWatchlists};
