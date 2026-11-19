"use strict";
function normalizePaperAccountState(account){
 if(!account||typeof account!=="object"||Array.isArray(account))return null;
 const positions=account.positions===undefined?{}:account.positions;
 const derivativePositions=account.derivativePositions===undefined?{}:account.derivativePositions;
 const reservedMarginPaise=account.reservedMarginPaise===undefined?0:account.reservedMarginPaise;
 const reservedCashPaise=account.reservedCashPaise===undefined?0:account.reservedCashPaise;
 const reservedPositions=account.reservedPositions===undefined?{}:account.reservedPositions;
 const realizedPnlPaise=account.realizedPnlPaise===undefined?0:account.realizedPnlPaise;
 if(account.currency!=="INR"||
    !Number.isSafeInteger(account.startingCashPaise)||account.startingCashPaise<1||
    !Number.isSafeInteger(account.cashPaise)||account.cashPaise<0||
    !positions||typeof positions!=="object"||Array.isArray(positions)||
    !derivativePositions||typeof derivativePositions!=="object"||Array.isArray(derivativePositions)||
    !Number.isSafeInteger(reservedMarginPaise)||reservedMarginPaise<0||
    !Number.isSafeInteger(reservedCashPaise)||reservedCashPaise<0||reservedCashPaise+reservedMarginPaise>account.cashPaise||
    !reservedPositions||typeof reservedPositions!=="object"||Array.isArray(reservedPositions)||
    !Number.isSafeInteger(realizedPnlPaise))return null;
 for(const [key,value] of Object.entries(reservedPositions)){
  if(!key||!Number.isSafeInteger(value)||value<0||value>(positions[key]?.quantity??0))return null;
 }
 return {currency:"INR",startingCashPaise:account.startingCashPaise,cashPaise:account.cashPaise,
  positions,derivativePositions,reservedMarginPaise,reservedCashPaise,reservedPositions,realizedPnlPaise,
  updatedAt:account.updatedAt?.toMillis?.()||null};
}
async function ensurePaperAccount({db,ref,startingCashPaise,serverTimestamp}){
 if(!db||typeof db.runTransaction!=="function"||!ref||typeof serverTimestamp!=="function")
  throw new TypeError("Paper account initialization dependencies are invalid.");
 await db.runTransaction(async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists){
   if(!Number.isSafeInteger(startingCashPaise)||startingCashPaise<1)
    throw Object.assign(new Error("Indian paper-trading starting balance is not configured by the administrator."),{status:503});
   const timestamp=serverTimestamp();
   tx.create(ref,{currency:"INR",startingCashPaise,cashPaise:startingCashPaise,positions:{},derivativePositions:{},
    reservedMarginPaise:0,reservedCashPaise:0,reservedPositions:{},realizedPnlPaise:0,createdAt:timestamp,updatedAt:timestamp,version:1});
  }else{
   const account=snap.data()||{};
   const patch={};
   if(account.positions===undefined)patch.positions={};
   if(account.derivativePositions===undefined)patch.derivativePositions={};
   if(account.reservedMarginPaise===undefined)patch.reservedMarginPaise=0;
   if(account.reservedCashPaise===undefined)patch.reservedCashPaise=0;
   if(account.reservedPositions===undefined)patch.reservedPositions={};
   if(Object.keys(patch).length){patch.updatedAt=serverTimestamp();tx.update(ref,patch);}
  }
 });
}
module.exports={normalizePaperAccountState,ensurePaperAccount};
