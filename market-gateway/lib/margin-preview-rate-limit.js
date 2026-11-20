"use strict";

const DEFAULT_COOLDOWN_MS=5000;

async function consumeMarginPreviewSlot(db,uid,nowMs=Date.now(),cooldownMs=DEFAULT_COOLDOWN_MS){
 if(!db||typeof db.runTransaction!=="function"||typeof uid!=="string"||!uid||
    !Number.isSafeInteger(nowMs)||nowMs<0||!Number.isSafeInteger(cooldownMs)||cooldownMs<1)
  throw new TypeError("Invalid margin preview rate-limit configuration.");
 const ref=db.collection("indianMarginPreviewLimits").doc(uid);
 return db.runTransaction(async transaction=>{
  const snapshot=await transaction.get(ref);
  const lastRequestAtMs=snapshot.exists?snapshot.data()?.lastRequestAtMs:null;
  if(lastRequestAtMs!==null&&(!Number.isSafeInteger(lastRequestAtMs)||lastRequestAtMs<0))
   throw Object.assign(new Error("Margin preview rate-limit state is invalid."),{status:503});
  if(lastRequestAtMs!==null){
   const elapsedMs=Math.max(0,nowMs-lastRequestAtMs);
   if(elapsedMs<cooldownMs){
    const retryAfterSeconds=Math.max(1,Math.ceil((cooldownMs-elapsedMs)/1000));
    throw Object.assign(new Error("Please wait before requesting another broker margin preview."),{status:429,retryAfterSeconds});
   }
  }
  transaction.set(ref,{lastRequestAtMs:nowMs,updatedAtMs:nowMs});
  return {allowed:true};
 });
}
module.exports={consumeMarginPreviewSlot,DEFAULT_COOLDOWN_MS};
