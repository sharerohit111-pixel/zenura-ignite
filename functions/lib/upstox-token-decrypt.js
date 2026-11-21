"use strict";

const crypto=require("node:crypto");

function decodeCanonicalBase64(value,minBytes,maxBytes){
  if(typeof value!=="string"||!value||
     !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error("Invalid encrypted token field.");
  const decoded=Buffer.from(value,"base64");
  if(decoded.length<minBytes||decoded.length>maxBytes||decoded.toString("base64")!==value)
    throw new Error("Invalid encrypted token field.");
  return decoded;
}

function decryptPendingUpstoxToken(envelope,keyValue){
  const key=decodeCanonicalBase64(keyValue,32,32);
  if(!envelope||typeof envelope!=="object"||Array.isArray(envelope)||envelope.v!==1)
    throw new Error("Invalid encrypted Upstox token envelope.");
  const iv=decodeCanonicalBase64(envelope.iv,12,12);
  const tag=decodeCanonicalBase64(envelope.tag,16,16);
  const data=decodeCanonicalBase64(envelope.data,1,16384);
  const decipher=crypto.createDecipheriv("aes-256-gcm",key,iv);
  decipher.setAuthTag(tag);
  const plain=Buffer.concat([decipher.update(data),decipher.final()]);
  const token=plain.toString("utf8");
  if(!token.trim()||token.length>16384||/[\u0000-\u001f\u007f]/.test(token)||
     !Buffer.from(token,"utf8").equals(plain))
    throw new Error("Invalid decrypted Upstox token.");
  return token;
}

module.exports={decryptPendingUpstoxToken};
