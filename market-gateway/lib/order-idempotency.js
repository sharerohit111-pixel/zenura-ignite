"use strict";
const crypto=require("node:crypto");
function isUuid(value){return typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}
function makeOrderId(uid,idempotencyKey){
 if(typeof uid!=="string"||!uid||!isUuid(idempotencyKey))throw Object.assign(new Error("Invalid order idempotency identity."),{status:400});
 return crypto.createHash("sha256").update(uid+":"+idempotencyKey).digest("hex");
}
function makeOrderFingerprint({instrumentKey,side,quantity,orderType="MARKET",limitPricePaise}){
 if(typeof instrumentKey!=="string"||!instrumentKey||!["BUY","SELL"].includes(side)||!Number.isSafeInteger(quantity)||quantity<1||!["MARKET","LIMIT"].includes(orderType)||
    (orderType==="LIMIT"&&(!Number.isSafeInteger(limitPricePaise)||limitPricePaise<1))||
    (orderType==="MARKET"&&limitPricePaise!==undefined))
  throw Object.assign(new Error("Invalid order request fingerprint."),{status:400});
 // Preserve the original MARKET fingerprint so retries of pre-upgrade orders remain idempotent.
 const payload=orderType==="MARKET"?{instrumentKey,side,quantity}:{instrumentKey,side,quantity,orderType,limitPricePaise};
 return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
function buildPaperOrderUpdate(account,{instrumentKey,side,quantity,pricePaise}){
 if(!account||typeof account!=="object"||
    (account.positions!==undefined&&(!account.positions||typeof account.positions!=="object"||Array.isArray(account.positions))))
  throw Object.assign(new Error("Invalid paper account state."),{status:409});
 const {calculatePaperFill}=require("./paper-math");
 const reservedCashPaise=account.reservedCashPaise===undefined?0:account.reservedCashPaise;
 const reservedMarginPaise=account.reservedMarginPaise===undefined?0:account.reservedMarginPaise;
 const reservedPositions=account.reservedPositions===undefined?{}:account.reservedPositions;
 if(!Number.isSafeInteger(reservedCashPaise)||reservedCashPaise<0||!Number.isSafeInteger(reservedMarginPaise)||reservedMarginPaise<0||
    reservedCashPaise+reservedMarginPaise>account.cashPaise||!reservedPositions||typeof reservedPositions!=="object"||Array.isArray(reservedPositions))
  throw Object.assign(new Error("Paper account contains invalid reserved resources."),{status:409});
 for(const [key,value] of Object.entries(reservedPositions)){
  if(!key||!Number.isSafeInteger(value)||value<0||value>(account.positions?.[key]?.quantity??0))
   throw Object.assign(new Error("Paper account contains invalid reserved share quantities."),{status:409});
 }
 // The portfolio reader treats a missing legacy positions map as an empty portfolio.
 const positions={...(account.positions||{})};
 let openPositionCount=0;
 // Validate all persisted records and count only open holdings, matching portfolio valuation.
 for(const [storedKey,stored] of Object.entries(positions)){
  if(!storedKey||!stored||typeof stored!=="object"||Array.isArray(stored)||
     !Number.isSafeInteger(stored.quantity)||stored.quantity<0||stored.quantity>1000000||
     !Number.isSafeInteger(stored.averagePricePaise)||stored.averagePricePaise<0||
     (stored.quantity>0&&stored.averagePricePaise<1))
   throw Object.assign(new Error("Paper account contains a malformed cash-equity position."),{status:409});
  const legacyCost=stored.quantity*stored.averagePricePaise;
  const costBasis=stored.costBasisPaise===undefined?legacyCost:stored.costBasisPaise;
  if(!Number.isSafeInteger(legacyCost)||!Number.isSafeInteger(costBasis)||costBasis<0||
     (stored.quantity>0&&costBasis<1)||(stored.quantity===0&&costBasis!==0)||
     (stored.quantity>0&&Math.round(costBasis/stored.quantity)!==stored.averagePricePaise))
   throw Object.assign(new Error("Paper account contains an invalid cash-equity cost basis."),{status:409});
  if(stored.quantity>0)openPositionCount++;
 }
 // Closed legacy entries do not consume the 50-open-position valuation limit.
 if(side==="BUY"&&!(positions[instrumentKey]?.quantity>0)&&openPositionCount>=50)
  throw Object.assign(new Error("Paper portfolio is limited to 50 open positions. Close an existing position before opening another."),{status:409});
 const position={...(positions[instrumentKey]||{quantity:0,averagePricePaise:0})};
 const availableQuantity=position.quantity-(reservedPositions[instrumentKey]||0);
 if(side==="SELL"&&quantity>availableQuantity)
  throw Object.assign(new Error("Insufficient unreserved shares for this paper sell order."),{status:409});
 const availableCashPaise=account.cashPaise-reservedCashPaise-reservedMarginPaise;
 const fill=calculatePaperFill({side,quantity,pricePaise,cashPaise:availableCashPaise,realizedPnlPaise:account.realizedPnlPaise??0,position});
 if(fill.position.quantity===0)delete positions[instrumentKey];else positions[instrumentKey]=fill.position;
 const currentVersion=account.version===undefined?1:account.version;if(!Number.isSafeInteger(currentVersion)||currentVersion<1||currentVersion>=Number.MAX_SAFE_INTEGER)throw Object.assign(new Error("Invalid paper account version."),{status:409});
 return {cashPaise:fill.cashPaise+reservedCashPaise+reservedMarginPaise,realizedPnlPaise:fill.realizedPnlPaise,positions,reservedCashPaise,reservedPositions:{...reservedPositions},orderRealizedPnlPaise:fill.orderRealizedPnlPaise,grossPaise:fill.grossPaise,version:currentVersion+1};
}
function assertIdempotentReplay(existingOrder,requestFingerprint){
 if(!existingOrder||existingOrder.requestFingerprint!==requestFingerprint)
  throw Object.assign(new Error("This idempotency key was already used for a different order. Submit a new order with a new key."),{status:409});
 return true;
}
module.exports={isUuid,makeOrderId,makeOrderFingerprint,buildPaperOrderUpdate,assertIdempotentReplay};
