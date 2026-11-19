"use strict";

const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function userScopedStorageKey(baseKey,userId){
  if(typeof baseKey!=="string"||!baseKey||typeof userId!=="string"||!userId)return null;
  return baseKey+":"+encodeURIComponent(userId);
}

function canRetryPendingPaperOrder(pendingFingerprint,nextFingerprint){
  return typeof pendingFingerprint === "string" && pendingFingerprint.length > 0
    && pendingFingerprint === nextFingerprint;
}

function readPendingPaperOrder(storage,storageKey){
  if(!storage||typeof storage.getItem!=="function"||typeof storageKey!=="string"||!storageKey)return null;
  try{
    const value=JSON.parse(storage.getItem(storageKey)||"null");
    if(!value||typeof value!=="object"||typeof value.fingerprint!=="string"||!value.fingerprint||
       typeof value.key!=="string"||!UUID_PATTERN.test(value.key))return null;
    return {fingerprint:value.fingerprint,key:value.key};
  }catch(_){return null;}
}

function writePendingPaperOrder(storage,storageKey,pending){
  if(!storage||typeof storage.setItem!=="function"||typeof storageKey!=="string"||!storageKey||
     !pending||typeof pending.fingerprint!=="string"||!pending.fingerprint||
     typeof pending.key!=="string"||!UUID_PATTERN.test(pending.key))return false;
  try{storage.setItem(storageKey,JSON.stringify({fingerprint:pending.fingerprint,key:pending.key}));return true;}
  catch(_){return false;}
}

function clearPendingPaperOrder(storage,storageKey){
  if(!storage||typeof storage.removeItem!=="function"||typeof storageKey!=="string"||!storageKey)return false;
  try{storage.removeItem(storageKey);return true;}
  catch(_){return false;}
}

const policy={userScopedStorageKey,canRetryPendingPaperOrder,readPendingPaperOrder,writePendingPaperOrder,clearPendingPaperOrder};
if(typeof window!=="undefined")window.ZenuraPaperOrderRetryPolicy=policy;
if(typeof module!=="undefined"&&module.exports)module.exports=policy;