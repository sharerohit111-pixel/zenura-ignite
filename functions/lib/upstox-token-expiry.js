"use strict";

// Upstox standard access tokens expire at 03:30 Asia/Kolkata,
// regardless of the time at which the token was generated.
const IST_OFFSET_MS=330*60*1000;
const CUTOFF_HOUR=3;
const CUTOFF_MINUTE=30;
function nextUpstoxTokenExpiry(now=Date.now()){
 if(!Number.isSafeInteger(now)||now<0)throw new TypeError("Invalid token issue time");
 const ist=new Date(now+IST_OFFSET_MS);
 let cutoffUtc=Date.UTC(ist.getUTCFullYear(),ist.getUTCMonth(),ist.getUTCDate(),CUTOFF_HOUR,CUTOFF_MINUTE)-IST_OFFSET_MS;
 if(cutoffUtc<=now)cutoffUtc+=24*60*60*1000;
 if(!Number.isSafeInteger(cutoffUtc))throw new RangeError("Token expiry is outside the safe timestamp range");
 return cutoffUtc;
}
module.exports={nextUpstoxTokenExpiry};
