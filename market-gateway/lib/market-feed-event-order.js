"use strict";

/**
 * Create a per-stream monotonic event filter. Upstox LTPC timestamps are
 * milliseconds; equal timestamps are duplicates and older timestamps are
 * delayed/out-of-order updates. Keep state scoped to one stream lifecycle.
 */
function createMarketFeedEventOrderFilter(){
  const lastTradeTimeByInstrument=new Map();
  return function acceptMarketFeedEvent(payload){
    if(!payload||typeof payload!=="object"||!payload.feeds||typeof payload.feeds!=="object")return null;
    const feeds={};
    for(const [instrumentKey,feed] of Object.entries(payload.feeds)){
      const quote=feed?.ltpc||feed?.fullFeed?.marketFF?.ltpc||feed?.fullFeed?.indexFF?.ltpc;
      const tradeTime=Number(quote?.ltt);
      if(!Number.isSafeInteger(tradeTime)||tradeTime<=0)continue;
      const previous=lastTradeTimeByInstrument.get(instrumentKey);
      if(previous!==undefined&&tradeTime<=previous)continue;
      lastTradeTimeByInstrument.set(instrumentKey,tradeTime);
      feeds[instrumentKey]=feed;
    }
    return Object.keys(feeds).length?{...payload,feeds}:null;
  };
}
module.exports={createMarketFeedEventOrderFilter};
