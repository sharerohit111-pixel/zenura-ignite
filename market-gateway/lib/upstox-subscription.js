"use strict";
const crypto=require("node:crypto");
function createUpstoxSubscription({mode,instrumentKeys,guid=crypto.randomUUID()}){
 if(!["ltpc","full","option_greeks"].includes(mode))throw new TypeError("Unsupported Upstox feed mode");
 if(!Array.isArray(instrumentKeys)||instrumentKeys.length===0||instrumentKeys.some(key=>typeof key!=="string"||!key.trim()))throw new TypeError("A non-empty list of instrument keys is required");
 if(new Set(instrumentKeys).size!==instrumentKeys.length)throw new TypeError("Duplicate instrument keys are not allowed");
 if(typeof guid!=="string"||!guid.trim())throw new TypeError("A subscription GUID is required");
 return {guid,method:"sub",data:{mode,instrumentKeys:[...instrumentKeys]}};
}
function sendUpstoxSubscription(socket,options){
 if(!socket||socket.readyState!==1||typeof socket.send!=="function")return Promise.reject(new Error("Upstox WebSocket is not open"));
 const payload=Buffer.from(JSON.stringify(createUpstoxSubscription(options)));
 return new Promise((resolve,reject)=>socket.send(payload,error=>error?reject(error):resolve(payload)));
}
module.exports={createUpstoxSubscription,sendUpstoxSubscription};
