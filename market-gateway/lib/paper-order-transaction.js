"use strict";
const {buildPaperOrderUpdate,assertIdempotentReplay}=require("./order-idempotency");
const {normalizeProductMode,getProductPositionFieldNames}=require("./product-mode");

/** Shared production transaction used by the HTTP route and emulator tests. */
async function executePaperOrderTransaction({db,accountRef,orderRef,uid,requestFingerprint,order,pricePaise,publicPaperOrder,serverTimestamp}){
  if(!db||typeof db.runTransaction!=="function"||!accountRef||accountRef.id!==uid||!orderRef||typeof uid!=="string"||!uid||typeof requestFingerprint!=="string"||!requestFingerprint||!order||order.uid!==uid||order.requestFingerprint!==requestFingerprint||typeof publicPaperOrder!=="function"||typeof serverTimestamp!=="function") throw new TypeError("Paper order transaction identity or dependencies are invalid.");
  const product=normalizeProductMode(order.product);
  const fields=getProductPositionFieldNames(product);
  if(!fields)throw Object.assign(new Error("Invalid paper product mode."),{status:400});
  let result;
  await db.runTransaction(async tx=>{
    const [accountSnap,existingOrder]=await Promise.all([tx.get(accountRef),tx.get(orderRef)]);
    if(existingOrder.exists){
      const prior=existingOrder.data();
      if(prior?.uid!==uid)throw Object.assign(new Error("Stored paper order does not belong to the authenticated account."),{status:409});
      assertIdempotentReplay(prior,requestFingerprint);
      if(!accountSnap.exists)throw Object.assign(new Error("Paper account is not initialized."),{status:409});
      const current=accountSnap.data();
      if(!Number.isSafeInteger(current.cashPaise)||current.cashPaise<0||!Number.isSafeInteger(current.realizedPnlPaise??0))
        throw Object.assign(new Error("Paper account contains invalid balance data."),{status:409});
      result=publicPaperOrder(prior,{orderId:orderRef.id,cashPaise:current.cashPaise,realizedPnlTotalPaise:current.realizedPnlPaise??0,idempotentReplay:true});
      return;
    }
    if(!accountSnap.exists) throw Object.assign(new Error("Paper account is not initialized."),{status:409});
    const next=buildPaperOrderUpdate(accountSnap.data(),{instrumentKey:order.instrumentKey,side:order.side,quantity:order.quantity,pricePaise,product});
    const storedOrder={...order,product,grossPaise:next.grossPaise,realizedPnlPaise:next.orderRealizedPnlPaise,createdAt:serverTimestamp()};
    const accountPatch={cashPaise:next.cashPaise,reservedCashPaise:next.reservedCashPaise,reservedMarginPaise:next.reservedMarginPaise,
      realizedPnlPaise:next.realizedPnlPaise,[fields.positionsField]:next[fields.positionsField],
      [fields.reservedPositionsField]:next[fields.reservedPositionsField],[fields.realizedPnlField]:next[fields.realizedPnlField],
      updatedAt:serverTimestamp(),version:next.version};
    tx.create(orderRef,storedOrder);
    tx.update(accountRef,accountPatch);
    result=publicPaperOrder(storedOrder,{orderId:orderRef.id,cashPaise:next.cashPaise,realizedPnlTotalPaise:next.realizedPnlPaise});
  });
  return result;
}
module.exports={executePaperOrderTransaction};
