"use strict";
function validLeaseOptions(now,leaseMs,collection){
 return Number.isSafeInteger(now)&&now>=0&&Number.isSafeInteger(leaseMs)&&leaseMs>=1000&&Number.isSafeInteger(now+leaseMs)&&typeof collection==="string"&&collection.length>0;
}
function isActiveLease(current,uid,leaseId,now){
 return !!current&&current.uid===uid&&current.leaseId===leaseId&&Number.isSafeInteger(current.expiresAtMs)&&current.expiresAtMs>now;
}
async function acquireStreamLease(db,uid,leaseId,{now=Date.now(),leaseMs=60000,collection="indianMarketStreamLeases"}={}){
 if(!validLeaseOptions(now,leaseMs,collection))return false;
 if(!db||typeof uid!=="string"||!uid||typeof leaseId!=="string"||!leaseId )return false;
 const ref=db.collection(collection).doc(uid);
 return db.runTransaction(async tx=>{
  const snap=await tx.get(ref),current=snap.exists?snap.data():null;
  if(current&&Number.isSafeInteger(current.expiresAtMs)&&current.expiresAtMs>now&&current.leaseId!==leaseId&&current.revoked!==true)return false;
  tx.set(ref,{uid,leaseId,expiresAtMs:now+leaseMs,updatedAtMs:now});
  return true;
 });
}
async function renewStreamLease(db,uid,leaseId,{now=Date.now(),leaseMs=60000,collection="indianMarketStreamLeases"}={}){
 if(!db||typeof uid!=="string"||!uid||typeof leaseId!=="string"||!leaseId||!validLeaseOptions(now,leaseMs,collection))return false;
 const ref=db.collection(collection).doc(uid);
 return db.runTransaction(async tx=>{
  const snap=await tx.get(ref),current=snap.exists?snap.data():null;
  if(current?.revoked===true||!isActiveLease(current,uid,leaseId,now))return false;
  tx.set(ref,{...current,expiresAtMs:now+leaseMs,updatedAtMs:now});
  return true;
 });
}
async function releaseStreamLease(db,uid,leaseId,{collection="indianMarketStreamLeases"}={}){
 if(!db||typeof uid!=="string"||!uid||typeof leaseId!=="string"||!leaseId||typeof collection!=="string"||!collection)return false;
 const ref=db.collection(collection).doc(uid);
 return db.runTransaction(async tx=>{
  const snap=await tx.get(ref),current=snap.exists?snap.data():null;
  if(!current||current.uid!==uid||current.leaseId!==leaseId)return false;
  tx.delete(ref);
  return true;
 });
}
module.exports={acquireStreamLease,renewStreamLease,releaseStreamLease};
