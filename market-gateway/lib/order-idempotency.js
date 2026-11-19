"use strict";
const crypto=require("node:crypto");
function isUuid(value){return typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}
function makeOrderId(uid,idempotencyKey){
 if(typeof uid!=="string"||!uid||!isUuid(idempotencyKey))throw Object.assign(new Error("Invalid order idempotency identity."),{status:400});
 return crypto.createHash("sha256").update(uid+":"+idempotencyKey).digest("hex");
}
function makeOrderFingerprint({instrumentKey,side,quantity,orderType="MARKET"}){
 if(typeof instrumentKey!=="string"||!instrumentKey||!["BUY","SELL"].includes(side)||!Number.isSafeInteger(quantity)||quantity<1||!["MARKET","LIMIT"].includes(orderType))
  throw Object.assign(new Error("Invalid order request fingerprint."),{status:400});
 return crypto.createHash("sha256").update(JSON.stringify({instrumentKey,side,quantity,orderType})).digest("hex");
}
function buildPaperOrderUpdate(account,{instrumentKey,side,quantity,pricePaise}){
 if(!account||typeof account!=="object"||
    (account.positions!==undefined&&(!account.positions||typeof account.positions!=="object"||Array.isArray(account.positions))))
  throw Object.assign(new Error("Invalid paper account state."),{status:409});
 const {calculatePaperFill}=require("./paper-math");
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
 if(side==="BUY"&&!Object.prototype.hasOwnProperty.call(positions,instrumentKey)&&openPositionCount>=50)
  throw Object.assign(new Error("Paper portfolio is limited to 50 open positions. Close an existing position before opening another."),{status:409});
 const position={...(positions[instrumentKey]||{quantity:0,averagePricePaise:0})};
 const fill=calculatePaperFill({side,quantity,pricePaise,cashPaise:account.cashPaise,realizedPnlPaise:account.realizedPnlPaise??0,position});
 if(fill.position.quantity===0)delete positions[instrumentKey];else positions[instrumentKey]=fill.position;
 const currentVersion=account.version===undefined?1:account.version;if(!Number.isSafeInteger(currentVersion)||currentVersion<1||currentVersion>=Number.MAX_SAFE_INTEGER)throw Object.assign(new Error("Invalid paper account version."),{status:409});
 return {cashPaise:fill.cashPaise,realizedPnlPaise:fill.realizedPnlPaise,positions,orderRealizedPnlPaise:fill.orderRealizedPnlPaise,grossPaise:fill.grossPaise,version:currentVersion+1};
}
function assertIdempotentReplay(existingOrder,requestFingerprint){
 if(!existingOrder||existingOrder.requestFingerprint!==requestFingerprint)
  throw Object.assign(new Error("This idempotency key was already used for a different order. Submit a new order with a new key."),{status:409});
 return true;
}
module.exports={isUuid,makeOrderId,makeOrderFingerprint,buildPaperOrderUpdate,assertIdempotentReplay};
