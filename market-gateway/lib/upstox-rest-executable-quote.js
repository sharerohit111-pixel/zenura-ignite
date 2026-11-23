"use strict";

// Full Market Quotes V3 REST snapshots expose top-of-book under depth.buy/sell.
// The response timestamp is the snapshot timestamp; last_trade_time is not a
// substitute. No LTP fallback is permitted for LIMIT execution.

function fail(message){
  throw Object.assign(new Error(message),{status:409});
}
function toTimestampMs(value){
  if(typeof value!=="string"||!/T.*(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value))return null;
  const ms=Date.parse(value);
  return Number.isSafeInteger(ms)&&ms>0?ms:null;
}
function toPricePaise(value){
  if(typeof value!=="number"||!Number.isFinite(value)||value<=0)return null;
  const paise=Math.round(value*100);
  return Number.isSafeInteger(paise)&&paise>0&&Math.abs(value*100-paise)<1e-7?paise:null;
}
function normalizeLevel(level){
  if(!level||typeof level!=="object"||Array.isArray(level))return null;
  const pricePaise=toPricePaise(level.price);
  const quantity=level.quantity;
  if(pricePaise===null||!Number.isSafeInteger(quantity)||quantity<=0||quantity>2147483647)return null;
  return {pricePaise,quantity};
}
function extractUpstoxRestExecutableQuote(payload,instrumentKey,{
  nowMs=Date.now(),maxAgeMs=15000
}={}){
  if(!payload||typeof payload!=="object"||payload.status!=="success"
     ||!payload.data||typeof payload.data!=="object"||Array.isArray(payload.data)
     ||typeof instrumentKey!=="string"||!instrumentKey
     ||!Number.isSafeInteger(nowMs)||nowMs<=0
     ||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<=0){
    fail("Invalid Upstox V3 REST executable quote request.");
  }
  const entry=Object.values(payload.data).find(item=>
    item&&typeof item==="object"&&item.instrument_token===instrumentKey
  );
  if(!entry)fail("Requested instrument is missing from the Upstox V3 quote response.");
  const timestampMs=toTimestampMs(entry.timestamp);
  if(timestampMs===null||timestampMs>nowMs||nowMs-timestampMs>maxAgeMs)
    fail("Upstox V3 quote snapshot is missing, future-dated or stale.");
  if(!entry.depth||typeof entry.depth!=="object"
     ||!Array.isArray(entry.depth.buy)||!Array.isArray(entry.depth.sell)){
    fail("Upstox V3 executable bid/ask depth is unavailable; LTP fallback is disabled.");
  }
  const bid=normalizeLevel(entry.depth.buy[0]);
  const ask=normalizeLevel(entry.depth.sell[0]);
  if(bid&&ask&&bid.pricePaise>ask.pricePaise)
    fail("Upstox V3 returned a crossed bid/ask book; executable quote rejected.");
  return Object.freeze({
    instrumentKey,timestampMs,ageMs:nowMs-timestampMs,
    bidPricePaise:bid?.pricePaise??null,
    bidQuantity:bid?.quantity??0,
    askPricePaise:ask?.pricePaise??null,
    askQuantity:ask?.quantity??0
  });
}
function evaluateUpstoxRestDerivativeLimit(payload,instrumentKey,{
  side,limitPricePaise,remainingQuantity,nowMs=Date.now(),maxAgeMs=15000
}={}){
  if(!["BUY","SELL"].includes(side)||!Number.isSafeInteger(limitPricePaise)||limitPricePaise<=0
     ||!Number.isSafeInteger(remainingQuantity)||remainingQuantity<1){
    throw new TypeError("Invalid Futures LIMIT executable-side evaluation.");
  }
  const quote=extractUpstoxRestExecutableQuote(payload,instrumentKey,{nowMs,maxAgeMs});
  if(quote.bidPricePaise===null||quote.askPricePaise===null
     ||quote.bidQuantity<1||quote.askQuantity<1){
    return Object.freeze({eligible:false,reason:"INCOMPLETE_DEPTH_BOOK",fillQuantity:0,pricePaise:null,...quote});
  }
  const pricePaise=side==="BUY"?quote.askPricePaise:quote.bidPricePaise;
  const availableQuantity=side==="BUY"?quote.askQuantity:quote.bidQuantity;
  if(pricePaise===null||availableQuantity<1)
    return Object.freeze({eligible:false,reason:"MISSING_EXECUTABLE_SIDE",fillQuantity:0,pricePaise:null,...quote});
  const crossed=side==="BUY"?pricePaise<=limitPricePaise:pricePaise>=limitPricePaise;
  if(!crossed)
    return Object.freeze({eligible:false,reason:"LIMIT_NOT_REACHED",fillQuantity:0,pricePaise,...quote});
  return Object.freeze({
    eligible:true,reason:"LIMIT_REACHED",
    fillQuantity:Math.min(remainingQuantity,availableQuantity),
    pricePaise,...quote
  });
}

module.exports={extractUpstoxRestExecutableQuote,evaluateUpstoxRestDerivativeLimit};
