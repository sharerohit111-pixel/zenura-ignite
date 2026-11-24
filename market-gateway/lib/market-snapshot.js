"use strict";

function fail(message){throw Object.assign(new Error(message),{status:502});}
function parseTimestamp(value){
  if(typeof value!=="string"||!/(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value))return null;
  const parsed=Date.parse(value);
  return Number.isSafeInteger(parsed)&&parsed>0?parsed:null;
}
function pricePaise(value){
  if(typeof value!=="number"||!Number.isFinite(value)||value<=0)return null;
  const scaled=value*100,rounded=Math.round(scaled);
  return Number.isSafeInteger(rounded)&&rounded>0&&Math.abs(scaled-rounded)<1e-6?rounded:null;
}
function normalizeDepthLevels(levels,side,tickSizePaise){
  if(!Array.isArray(levels)||levels.length>5)fail("Provider depth must contain at most five levels.");
  let previous=null;
  return levels.map(level=>{
    const price=pricePaise(level?.price),quantity=level?.quantity,orders=level?.orders;
    if(price===null||!Number.isSafeInteger(quantity)||quantity<0||quantity>2147483647
      ||!Number.isSafeInteger(orders)||orders<0||orders>2147483647
      ||(tickSizePaise&&price%tickSizePaise!==0))fail("Provider depth contains an invalid price, quantity or tick.");
    if(previous!==null&&(side==="BID"?price>previous:price<previous))fail("Provider depth is not ordered by price.");
    previous=price;
    return Object.freeze({pricePaise:price,quantity,orders});
  });
}
function normalizeMarketDepthQuote(payload,instrument,{nowMs=Date.now(),maxAgeMs=15000}={}){
  if(!payload||payload.status!=="success"||!instrument||typeof instrument.instrument_key!=="string"
    ||!Number.isSafeInteger(nowMs)||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1)fail("Invalid market-depth request.");
  const quote=Object.values(payload.data||{}).find(item=>item?.instrument_token===instrument.instrument_key);
  if(!quote)fail("Provider did not return the requested instrument.");
  const timestampMs=parseTimestamp(quote.timestamp),ageMs=timestampMs===null?null:nowMs-timestampMs;
  if(timestampMs===null||ageMs<0)fail("Provider quote timestamp is missing or in the future.");
  const tick=pricePaise(Number(instrument.tick_size));
  const bids=normalizeDepthLevels(quote.depth?.buy||[],"BID",tick);
  const asks=normalizeDepthLevels(quote.depth?.sell||[],"ASK",tick);
  if(bids[0]&&asks[0]&&bids[0].pricePaise>asks[0].pricePaise)fail("Provider returned a crossed order book.");
  const ohlc=quote.ohlc||{};
  const normalizedOhlc={};
  for(const key of ["open","high","low","close"]){
    const value=pricePaise(ohlc[key]);
    if(value!==null)normalizedOhlc[key]=value;
  }
  if(Object.keys(normalizedOhlc).length===4&&(normalizedOhlc.high<Math.max(normalizedOhlc.open,normalizedOhlc.close)
    ||normalizedOhlc.low>Math.min(normalizedOhlc.open,normalizedOhlc.close)||normalizedOhlc.high<normalizedOhlc.low))
    fail("Provider returned invalid OHLC values.");
  return Object.freeze({
    provider:"UPSTOX",instrumentKey:instrument.instrument_key,timestampMs,ageMs,
    status:ageMs<=maxAgeMs?"fresh":"stale",bids:Object.freeze(bids),asks:Object.freeze(asks),
    ohlc:Object.freeze(normalizedOhlc),lastPricePaise:pricePaise(quote.last_price),
    volume:Number.isSafeInteger(quote.volume)&&quote.volume>=0?quote.volume:null
  });
}
const MARKET_STATUSES=new Set(["NORMAL_OPEN","NORMAL_CLOSE","PRE_OPEN_START","PRE_OPEN_END","PRE_OPEN_M_END","CLOSING_START","CLOSING_END","CTS_CLOSE","CAS_LM_START","CAS_M_STOP","CAS_STOP"]);
function normalizeMarketStatus(payload,exchange,{nowMs=Date.now(),maxAgeMs=300000}={}){
  const data=payload?.data;
  if(payload?.status!=="success"||!data||data.exchange!==exchange||!["NSE","BSE"].includes(exchange)
    ||!MARKET_STATUSES.has(data.status)||!Number.isSafeInteger(data.last_updated)||data.last_updated<=0)
    fail("Provider returned an invalid exchange market status.");
  const ageMs=nowMs-data.last_updated;
  if(ageMs<0)fail("Provider market-status timestamp is in the future.");
  const cas=data.cas_eligible_status;
  return Object.freeze({provider:"UPSTOX",exchange,status:data.status,lastUpdatedMs:data.last_updated,ageMs,
    freshness:ageMs<=maxAgeMs?"fresh":"stale",
    casStatus:cas&&MARKET_STATUSES.has(cas.status)?cas.status:null,
    casLastUpdatedMs:Number.isSafeInteger(cas?.last_updated)?cas.last_updated:null});
}
module.exports={normalizeMarketDepthQuote,normalizeMarketStatus};
