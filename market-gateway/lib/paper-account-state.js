"use strict";
function normalizePaperAccountState(account){
 if(!account||typeof account!=="object"||Array.isArray(account))return null;
 const positions=account.positions===undefined?{}:account.positions;
 const derivativePositions=account.derivativePositions===undefined?{}:account.derivativePositions;
 const reservedMarginPaise=account.reservedMarginPaise===undefined?0:account.reservedMarginPaise;
 const realizedPnlPaise=account.realizedPnlPaise===undefined?0:account.realizedPnlPaise;
 if(account.currency!=="INR"||
    !Number.isSafeInteger(account.startingCashPaise)||account.startingCashPaise<1||
    !Number.isSafeInteger(account.cashPaise)||account.cashPaise<0||
    !positions||typeof positions!=="object"||Array.isArray(positions)||
    !derivativePositions||typeof derivativePositions!=="object"||Array.isArray(derivativePositions)||
    !Number.isSafeInteger(reservedMarginPaise)||reservedMarginPaise<0||
    !Number.isSafeInteger(realizedPnlPaise))return null;
 return {currency:"INR",startingCashPaise:account.startingCashPaise,cashPaise:account.cashPaise,
  positions,derivativePositions,reservedMarginPaise,realizedPnlPaise,
  updatedAt:account.updatedAt?.toMillis?.()||null};
}
module.exports={normalizePaperAccountState};
