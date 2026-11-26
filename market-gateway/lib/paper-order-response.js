"use strict";
const ORDER_FIELDS=["tradingSymbol","exchange","side","quantity","product","executionPricePaise","limitPricePaise","grossPaise","quoteTimestampMs","quoteAgeMs","realizedPnlPaise","orderType","status","simulationOnly"];
function publicPaperOrder(order,{orderId,cashPaise,realizedPnlTotalPaise,idempotentReplay=false}={}){
 const result={};
 for(const field of ORDER_FIELDS)if(order?.[field]!==undefined)result[field]=order[field];
 const createdAt=order?.createdAt;
 result.createdAt=createdAt?.toMillis?.()??(createdAt instanceof Date?createdAt.getTime():null);
 result.orderId=orderId||order?.orderId||null;
 result.cashPaise=Number.isSafeInteger(cashPaise)?cashPaise:null;
 result.realizedPnlTotalPaise=Number.isSafeInteger(realizedPnlTotalPaise)?realizedPnlTotalPaise:0;
 if(idempotentReplay)result.idempotentReplay=true;
 return result;
}
module.exports={publicPaperOrder};
