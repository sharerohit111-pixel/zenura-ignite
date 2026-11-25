"use strict";

const MAX_RETRY_AFTER_SECONDS=300;

function parseRetryAfter(value,nowMs=Date.now()){
  if(typeof value!=="string"||!value.trim())return null;
  const raw=value.trim();
  let seconds;
  if(/^\d+(?:\.\d+)?$/.test(raw))seconds=Math.ceil(Number(raw));
  else{
    const date=Date.parse(raw);
    if(!Number.isFinite(date))return null;
    seconds=Math.ceil((date-nowMs)/1000);
  }
  if(!Number.isFinite(seconds)||seconds<0)return null;
  return Math.min(MAX_RETRY_AFTER_SECONDS,Math.max(1,seconds));
}

function upstoxHttpError(response,{nowMs=Date.now()}={}){
  const status=Number(response?.status);
  if(status===401)return Object.assign(new Error("Upstox authorization expired. Reconnect your Upstox account."),{
    status:401,code:"upstox_reconnect_required"
  });
  if(status===429){
    const retryAfterSeconds=parseRetryAfter(response?.headers?.get?.("retry-after")??null,nowMs);
    return Object.assign(new Error("Upstox rate limit reached. Try again later."),{
      status:429,code:"upstox_rate_limited",...(retryAfterSeconds===null?{}:{retryAfterSeconds})
    });
  }
  return Object.assign(new Error("Upstox market-data request failed."),{
    status:502,code:"upstream_provider_error"
  });
}

module.exports={parseRetryAfter,upstoxHttpError,MAX_RETRY_AFTER_SECONDS};
