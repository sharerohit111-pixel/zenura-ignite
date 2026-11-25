"use strict";
const MAX_RECONNECT_ATTEMPTS=5;
const BASE_RECONNECT_DELAY_MS=1000;
const MAX_RECONNECT_DELAY_MS=15000;
const MAX_PROVIDER_RETRY_AFTER_SECONDS=300;

function reconnectDelayMs(attempt,{retryAfterSeconds=null,random=Math.random}={}){
 if(!Number.isSafeInteger(attempt)||attempt<1||attempt>MAX_RECONNECT_ATTEMPTS)
  throw new TypeError("Reconnect attempt is outside the bounded retry policy.");
 if(typeof random!=="function")throw new TypeError("A random function is required.");
 const sample=random();
 if(!Number.isFinite(sample)||sample<0||sample>=1)throw new TypeError("Random sample must be in [0, 1).");
 const exponential=Math.min(MAX_RECONNECT_DELAY_MS,BASE_RECONNECT_DELAY_MS*(2**(attempt-1)));
 const jitter=Math.floor(sample*251);
 const providerDelay=Number.isFinite(retryAfterSeconds)&&retryAfterSeconds>0
  ?Math.min(MAX_PROVIDER_RETRY_AFTER_SECONDS,retryAfterSeconds)*1000:0;
 return Math.max(Math.min(MAX_RECONNECT_DELAY_MS,exponential+jitter),providerDelay);
}
module.exports={MAX_RECONNECT_ATTEMPTS,MAX_RECONNECT_DELAY_MS,reconnectDelayMs};
