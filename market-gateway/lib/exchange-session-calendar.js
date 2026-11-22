"use strict";

const {marketClockParts,normalizeExchangeSessionRow}=require("./intraday-limit-policy");

function marketDateString(timestampMs){
  const p=marketClockParts(timestampMs);
  return `${p.year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`;
}

async function loadVerifiedExchangeSession(serviceDb,exchange,nowMs=Date.now()){
  if(!serviceDb||typeof serviceDb.from!=="function"||![ "NSE","BSE" ].includes(exchange)
     ||!Number.isSafeInteger(nowMs)||nowMs<1) return null;
  const sessionDate=marketDateString(nowMs);
  const result=await serviceDb.from("paper_exchange_sessions")
    .select("exchange,session_date,is_trading_day,open_minute,close_minute,session_kind,source_reference,verified_at,source_sha256")
    .eq("exchange",exchange).eq("session_date",sessionDate).maybeSingle();
  if(result?.error)throw Object.assign(new Error("Verified exchange session calendar could not be read."),{status:503});
  if(!result?.data)return null;
  const session=normalizeExchangeSessionRow(result.data,exchange,sessionDate,nowMs);
  if(!session)return null;
  if(result.data.session_kind==="CLOSED"||![ "REGULAR","SPECIAL" ].includes(result.data.session_kind))return null;
  return session;
}

module.exports={marketDateString,loadVerifiedExchangeSession};
