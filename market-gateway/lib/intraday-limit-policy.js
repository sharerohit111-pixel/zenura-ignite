"use strict";

const MARKET_TIME_ZONE="Asia/Kolkata";
const SESSION_OPEN_MINUTE=9*60+15;
const SESSION_CLOSE_MINUTE=15*60+30;

function marketClockParts(timestampMs){
  if(!Number.isSafeInteger(timestampMs)||timestampMs<0)throw new TypeError("A valid epoch-millisecond timestamp is required.");
  const parts=new Intl.DateTimeFormat("en-GB",{
    timeZone:MARKET_TIME_ZONE,weekday:"short",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"
  }).formatToParts(new Date(timestampMs));
  const values=Object.fromEntries(parts.filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
  return {
    weekday:values.weekday,year:Number(values.year),month:Number(values.month),day:Number(values.day),
    hour:Number(values.hour),minute:Number(values.minute),second:Number(values.second)
  };
}

function normalizeMarketSession(session){
  if(!session||typeof session!=="object"||session.isTradingDay!==true
     ||!Number.isInteger(session.openMinute)||!Number.isInteger(session.closeMinute)
     ||session.openMinute<0||session.closeMinute>24*60
     ||session.openMinute>=session.closeMinute)return null;
  return session;
}

function isIntradaySessionOpen(timestampMs,session){
  const normalized=normalizeMarketSession(session);
  if(!normalized)return false;
  const clock=marketClockParts(timestampMs);
  if(clock.weekday==="Sat"||clock.weekday==="Sun")return false;
  const minute=clock.hour*60+clock.minute;
  return minute>=normalized.openMinute&&minute<normalized.closeMinute;
}

function isIntradayOrderExpired(order,nowMs,session){
  if(!order||typeof order!=="object"||order.product!=="INTRADAY"
     ||order.order_type!=="LIMIT"||order.status!=="PENDING"
     ||typeof order.created_at!=="string"||!Number.isFinite(Date.parse(order.created_at))
     ||!Number.isSafeInteger(nowMs)||nowMs<0)return false;
  const created=marketClockParts(Date.parse(order.created_at));
  const now=marketClockParts(nowMs);
  const sameSessionDate=created.year===now.year&&created.month===now.month&&created.day===now.day;
  const normalized=normalizeMarketSession(session);
  if(!sameSessionDate||!normalized)return true;
  if(now.weekday==="Sat"||now.weekday==="Sun")return true;
  const minute=now.hour*60+now.minute;
  return minute>=normalized.closeMinute;
}

function isEligibleIntradayLimitOrder(order,quote,nowMs,session){
  if(!order||typeof order!=="object"||order.order_type!=="LIMIT"||order.status!=="PENDING"
     ||order.simulation_only!==true||order.product!=="INTRADAY"
     ||typeof order.user_id!=="string"||!order.user_id
     ||typeof order.instrument_key!=="string"||!order.instrument_key
     ||![ "BUY","SELL" ].includes(order.side)
     ||!Number.isSafeInteger(order.quantity)||order.quantity<1||order.quantity>1000000
     ||!Number.isSafeInteger(order.limit_price_paise)||order.limit_price_paise<1
     ||typeof order.created_at!=="string"||!Number.isFinite(Date.parse(order.created_at))
     ||!quote||!Number.isSafeInteger(quote.pricePaise)||quote.pricePaise<1
     ||!Number.isSafeInteger(quote.tradeTimeMs)||quote.tradeTimeMs<1
     ||!Number.isSafeInteger(nowMs)||nowMs<1||quote.tradeTimeMs>nowMs
     ||nowMs-quote.tradeTimeMs>15000
     ||!isIntradaySessionOpen(nowMs,session))return false;
  const normalized=normalizeMarketSession(session);
  const createdMs=Date.parse(order.created_at);
  if(createdMs>nowMs)return false;
  const created=marketClockParts(createdMs),now=marketClockParts(nowMs);
  if(created.year!==now.year||created.month!==now.month||created.day!==now.day)return false;
  const createdMinute=created.hour*60+created.minute;
  if(createdMinute<normalized.openMinute||createdMinute>=normalized.closeMinute)return false;
  return order.side==="BUY"?quote.pricePaise<=order.limit_price_paise:quote.pricePaise>=order.limit_price_paise;
}

module.exports={marketClockParts,normalizeMarketSession,isIntradaySessionOpen,isIntradayOrderExpired,isEligibleIntradayLimitOrder};
