"use strict";

function validateUpstoxFeedUrl(value){
 let url;
 try{url=new URL(value);}
 catch{throw new Error("Upstox returned an invalid market feed URL.");}
 const hostname=url.hostname.toLowerCase();
 const trustedHost=hostname==="upstox.com"||hostname.endsWith(".upstox.com");
 const validPath=url.pathname.startsWith("/market-data-feeder/v3/");
 const hasRequestId=Boolean(url.searchParams.get("requestId"));
 const hasCode=Boolean(url.searchParams.get("code"));
 if(url.protocol!=="wss:"||!trustedHost||url.username||url.password||url.port||url.hash||!validPath||!hasRequestId||!hasCode)
  throw new Error("Upstox returned an untrusted market feed URL.");
 return url.toString();
}

module.exports={validateUpstoxFeedUrl};
