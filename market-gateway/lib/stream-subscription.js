"use strict";
function validateStreamInstrumentKeys(rawKeys,officialKeys,maxKeys=100){
  if(!Array.isArray(rawKeys)||!Number.isSafeInteger(maxKeys)||maxKeys<1||rawKeys.length<1||rawKeys.length>maxKeys)
    throw Object.assign(new Error("Provide a valid instrumentKeys list within the configured per-session limit."),{status:400});
  const keys=[...new Set(rawKeys)];
  if(keys.length!==rawKeys.length||keys.some(key=>typeof key!=="string"||!key||key.length>100||/[\\u0000-\\u001F]/.test(key)))
    throw Object.assign(new Error("Instrument keys must be unique, non-empty official instrument identifiers."),{status:400});
  const allowed=officialKeys instanceof Set?officialKeys:new Set(officialKeys||[]);
  if(keys.some(key=>!allowed.has(key)))
    throw Object.assign(new Error("One or more instrument keys are not present in the official Upstox instrument master."),{status:400});
  return keys;
}
module.exports={validateStreamInstrumentKeys};
