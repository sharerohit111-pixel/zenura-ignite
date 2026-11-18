"use strict";
const crypto=require("node:crypto");
function isUuid(value){return typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}
function makeOrderId(uid,idempotencyKey){
 if(typeof uid!=="string"||!uid||!isUuid(idempotencyKey))throw Object.assign(new Error("Invalid order idempotency identity."),{status:400});
 return crypto.createHash("sha256").update(uid+":"+idempotencyKey).digest("hex");
}
function makeOrderFingerprint({instrumentKey,side,quantity}){
 if(typeof instrumentKey!=="string"||!instrumentKey||!["BUY","SELL"].includes(side)||!Number.isSafeInteger(quantity)||quantity<1)
  throw Object.assign(new Error("Invalid order request fingerprint."),{status:400});
 return crypto.createHash("sha256").update(JSON.stringify({instrumentKey,side,quantity})).digest("hex");
}
function assertIdempotentReplay(existingOrder,requestFingerprint){
 if(!existingOrder||existingOrder.requestFingerprint!==requestFingerprint)
  throw Object.assign(new Error("This idempotency key was already used for a different order. Submit a new order with a new key."),{status:409});
 return true;
}
module.exports={isUuid,makeOrderId,makeOrderFingerprint,assertIdempotentReplay};
