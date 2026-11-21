"use strict";
const crypto=require("node:crypto");
const {normalizeProductMode,getProductPositionFieldNames}=require("./product-mode");
function isUuid(value){return typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}
function makeOrderId(uid,idempotencyKey){
 if(typeof uid!=="string"||!uid||!isUuid(idempotencyKey))throw Object.assign(new Error("Invalid order idempotency identity."),{status:400});
 return crypto.createHash("sha256").update(uid+":"+idempotencyKey).digest("hex");
}
function makeOrderFingerprint({instrumentKey,side,quantity,orderType="MARKET",limitPricePaise,product}){
 const mode=normalizeProductMode(product);
 if(typeof instrumentKey!=="string"||!instrumentKey||!["BUY","SELL"].includes(side)||!Number.isSafeInteger(quantity)||quantity<1||!["MARKET","LIMIT"].includes(orderType)||mode===null||
    (orderType==="LIMIT"&&(!Number.isSafeInteger(limitPricePaise)||limitPricePaise<1))||
    (orderType==="MARKET"&&limitPricePaise!==undefined))
  throw Object.assign(new Error("Invalid order request fingerprint."),{status:400});
 // Keep the byte-for-byte legacy fingerprint for Delivery, including omitted product.
 const payload=orderType==="MARKET"?{instrumentKey,side,quantity}:{instrumentKey,side,quantity,orderType,limitPricePaise};
 if(mode==="INTRADAY")payload.product="INTRADAY";
 return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
function validatePositionMap(positions){
 if(!positions||typeof positions!=="object"||Array.isArray(positions))throw Object.assign(new Error("Invalid paper account state."),{status:409});
 let open=0;
 for(const [key,p] of Object.entries(positions)){
  if(!key||!p||typeof p!=="object"||Array.isArray(p)||!Number.isSafeInteger(p.quantity)||p.quantity<0||p.quantity>1000000||
     !Number.isSafeInteger(p.averagePricePaise)||p.averagePricePaise<0||(p.quantity>0&&p.averagePricePaise<1))
   throw Object.assign(new Error("Paper account contains a malformed cash-equity position."),{status:409});
  const legacy=p.quantity*p.averagePricePaise,cost=p.costBasisPaise===undefined?legacy:p.costBasisPaise;
  if(!Number.isSafeInteger(legacy)||!Number.isSafeInteger(cost)||cost<0||(p.quantity>0&&cost<1)||(p.quantity===0&&cost!==0)||
     (p.quantity>0&&Math.round(cost/p.quantity)!==p.averagePricePaise))
   throw Object.assign(new Error("Paper account contains an invalid cash-equity cost basis."),{status:409});
  if(p.quantity>0)open++;
 }
 return open;
}
function validateReservations(reserved,positions){
 if(!reserved||typeof reserved!=="object"||Array.isArray(reserved))throw Object.assign(new Error("Paper account contains invalid reserved share quantities."),{status:409});
 for(const [key,value] of Object.entries(reserved)){
  if(!key||!Number.isSafeInteger(value)||value<0||value>(positions[key]?.quantity??0))
   throw Object.assign(new Error("Paper account contains invalid reserved share quantities."),{status:409});
 }
}
function buildPaperOrderUpdate(account,{instrumentKey,side,quantity,pricePaise,product}){
 if(!account||typeof account!=="object"||Array.isArray(account))throw Object.assign(new Error("Invalid paper account state."),{status:409});
 const mode=normalizeProductMode(product),fields=getProductPositionFieldNames(product);
 if(mode===null)throw Object.assign(new Error("Invalid paper product mode."),{status:400});
 const delivery=account.positions===undefined?{}:account.positions;
 const intraday=account.intradayPositions===undefined?{}:account.intradayPositions;
 const deliveryReserved=account.reservedPositions===undefined?{}:account.reservedPositions;
 const intradayReserved=account.intradayReservedPositions===undefined?{}:account.intradayReservedPositions;
 const deliveryOpen=validatePositionMap(delivery),intradayOpen=validatePositionMap(intraday);
 validateReservations(deliveryReserved,delivery);validateReservations(intradayReserved,intraday);
 const positions={...(account[fields.positionsField]||{})};
 const reservedPositions=account[fields.reservedPositionsField]===undefined?{}:account[fields.reservedPositionsField];
 const reservedCashPaise=account.reservedCashPaise===undefined?0:account.reservedCashPaise;
 const reservedMarginPaise=account.reservedMarginPaise===undefined?0:account.reservedMarginPaise;
 const aggregateRealized=account.realizedPnlPaise===undefined?0:account.realizedPnlPaise;
 const modeRealized=account[fields.realizedPnlField]===undefined?(mode==="DELIVERY"?aggregateRealized:0):account[fields.realizedPnlField];
 if(!Number.isSafeInteger(account.cashPaise)||account.cashPaise<0||!Number.isSafeInteger(aggregateRealized)||!Number.isSafeInteger(modeRealized)||
    !Number.isSafeInteger(reservedCashPaise)||reservedCashPaise<0||!Number.isSafeInteger(reservedMarginPaise)||reservedMarginPaise<0||
    reservedCashPaise+reservedMarginPaise>account.cashPaise)
  throw Object.assign(new Error("Paper account contains invalid reserved resources."),{status:409});
 if(side==="BUY"&&!(positions[instrumentKey]?.quantity>0)&&deliveryOpen+intradayOpen>=50)
  throw Object.assign(new Error("Paper portfolio is limited to 50 open positions. Close an existing position before opening another."),{status:409});
 const position={...(positions[instrumentKey]||{quantity:0,averagePricePaise:0})};
 if(side==="SELL"&&quantity>position.quantity-(reservedPositions[instrumentKey]||0))
  throw Object.assign(new Error("Insufficient unreserved shares for this paper sell order."),{status:409});
 const availableCashPaise=account.cashPaise-reservedCashPaise-reservedMarginPaise;
 const {calculatePaperFill}=require("./paper-math");
 const fill=calculatePaperFill({side,quantity,pricePaise,cashPaise:availableCashPaise,realizedPnlPaise:modeRealized,position});
 if(fill.position.quantity===0)delete positions[instrumentKey];else positions[instrumentKey]=fill.position;
 const currentVersion=account.version===undefined?1:account.version;
 if(!Number.isSafeInteger(currentVersion)||currentVersion<1||currentVersion>=Number.MAX_SAFE_INTEGER)
  throw Object.assign(new Error("Invalid paper account version."),{status:409});
 const nextAggregate=aggregateRealized+fill.orderRealizedPnlPaise;
 if(!Number.isSafeInteger(nextAggregate))throw Object.assign(new Error("Paper account realized P&L exceeds safe calculation limits."),{status:409});
 return {cashPaise:fill.cashPaise+reservedCashPaise+reservedMarginPaise,reservedCashPaise,reservedMarginPaise,
  realizedPnlPaise:nextAggregate,[fields.positionsField]:positions,[fields.reservedPositionsField]:{...reservedPositions},
  [fields.realizedPnlField]:fill.realizedPnlPaise,orderRealizedPnlPaise:fill.orderRealizedPnlPaise,
  grossPaise:fill.grossPaise,version:currentVersion+1};
}
function assertIdempotentReplay(existingOrder,requestFingerprint){
 if(!existingOrder||existingOrder.requestFingerprint!==requestFingerprint)
  throw Object.assign(new Error("This idempotency key was already used for a different order. Submit a new order with a new key."),{status:409});
 return true;
}
module.exports={isUuid,makeOrderId,makeOrderFingerprint,buildPaperOrderUpdate,assertIdempotentReplay};
