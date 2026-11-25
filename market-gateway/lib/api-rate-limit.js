"use strict";

const RATE_LIMIT_BUCKETS=new Set(["market_data","paper_read","paper_write","account_read","account_write","oauth"]);

function apiRateLimitBucket(method,path){
  const verb=String(method||"").toUpperCase();
  const route=String(path||"");
  if(route==="/stream"||route==="/paper/derivative/margin-preview")return null;
  if((route==="/upstox/oauth/start"&&verb==="POST")
    ||(route==="/upstox/connection"&&verb==="DELETE"))return "oauth";
  if(verb==="GET"&&[
    "/candles","/option-chain","/watchlist/quotes",
    "/paper/portfolio","/paper/derivatives/portfolio","/paper/futures/portfolio"
  ].includes(route))return "market_data";
  if(route.startsWith("/paper/")||route==="/watchlist"||route==="/watchlists"){
    return ["GET","HEAD"].includes(verb)?"paper_read":"paper_write";
  }
  if(route==="/upstox/connection")return "account_read";
  return ["GET","HEAD"].includes(verb)?"account_read":"account_write";
}

async function consumeApiRateLimit(serviceDb,userId,bucket){
  if(!serviceDb||typeof serviceDb.rpc!=="function")throw Object.assign(
    new Error("Distributed API rate limiter is unavailable."),{status:503}
  );
  if(typeof userId!=="string"||!userId.trim()||!RATE_LIMIT_BUCKETS.has(bucket)){
    throw new TypeError("Invalid distributed API rate-limit identity or bucket.");
  }
  let result;
  try{
    result=await serviceDb.rpc("consume_paper_api_rate_limit",{
      p_user_id:userId,p_bucket:bucket
    });
  }catch(_error){
    throw Object.assign(new Error("Distributed API rate-limit check failed."),{status:503});
  }
  if(result?.error||!result||typeof result.data!=="object"||result.data===null
    ||typeof result.data.allowed!=="boolean"){
    throw Object.assign(new Error("Distributed API rate-limit check failed."),{status:503});
  }
  const retryAfterSeconds=Number(result.data.retry_after_seconds);
  if(!result.data.allowed&&(!Number.isSafeInteger(retryAfterSeconds)||retryAfterSeconds<1)){
    throw Object.assign(new Error("Distributed API rate-limit response was invalid."),{status:503});
  }
  return {
    allowed:result.data.allowed,
    retryAfterSeconds:result.data.allowed?0:retryAfterSeconds,
    remaining:Number.isSafeInteger(result.data.remaining)?result.data.remaining:null
  };
}

module.exports={RATE_LIMIT_BUCKETS,apiRateLimitBucket,consumeApiRateLimit};
