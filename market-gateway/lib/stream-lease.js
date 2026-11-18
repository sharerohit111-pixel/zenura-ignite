"use strict";
async function acquireStreamLease(db,uid,leaseId,{now=Date.now(),leaseMs=60000,collection="indianMarketStreamLeases"}={}){
 if(!db||typeof uid!=="string"||!uid||typeof leaseId!=="string"||!leaseId||!Number.isFinite(now)||!Number.isSafeInteger(leaseMs)||leaseMs<1000)return false;
 const ref=db.collection(collection).doc(uid);
 return db.runTransaction(async tx=>{
  const snap=await tx.get(ref),current=snap.exists?snap.data():null;
  if(current&&Number(current.expiresAtMs)>now&&current.leaseId!==leaseId)return false;
  tx.set(ref,{uid,leaseId,expiresAtMs:now+leaseMs,updatedAtMs:now});
  return true;
 });
}
async function renewStreamLease(db,uid,leaseId,{now=Date.now(),leaseMs=60000,collection="indianMarketStreamLeases"}={}){
 if(!db||typeof uid!=="string"||!uid||typeof leaseId!=="string"||!leaseId)return false;
 const ref=db.collection(collection).doc(uid);
 return db.runTransaction(async tx=>{
  const snap=await tx.get(ref),current=snap.exists?snap.data():null;
  if(!current||current.leaseId!==leaseId||Number(current.expiresAtMs)<=now)return false;
  tx.set(ref,{...current,expiresAtMs:now+leaseMs,updatedAtMs:now});
  return true;
 });
}
async function releaseStreamLease(db,uid,leaseId,{collection="indianMarketStreamLeases"}={}){
 if(!db||typeof uid!=="string"||!uid||typeof leaseId!=="string"||!leaseId)return false;
 const ref=db.collection(collection).doc(uid);
 return db.runTransaction(async tx=>{
  const snap=await tx.get(ref),current=snap.exists?snap.data():null;
  if(!current||current.leaseId!==leaseId)return false;
  tx.delete(ref);
  return true;
 });
}
module.exports={acquireStreamLease,renewStreamLease,releaseStreamLease};
