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

function mergeWatchlistUpdate(currentData,name,keys){
  if(!WATCHLIST_NAMES.includes(name))throw Object.assign(new Error("Choose a valid watchlist name."),{status:400});
  if(!Array.isArray(keys)||keys.length>50||keys.some(x=>typeof x!=="string"||!x||x.length>100||/[\u0000-\u001F]/.test(x)))
    throw Object.assign(new Error("Provide up to 50 valid instrument keys."),{status:400});
  const watchlists=normalizeWatchlists(currentData);
  watchlists[name]=[...new Set(keys)];
  return watchlists;
}
module.exports={WATCHLIST_NAMES,normalizeWatchlists,mergeWatchlistUpdate};
