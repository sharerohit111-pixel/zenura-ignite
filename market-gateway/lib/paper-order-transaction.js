"use strict";
const {buildPaperOrderUpdate,assertIdempotentReplay}=require("./order-idempotency");

/** Shared production transaction used by the HTTP route and emulator tests. */
async function executePaperOrderTransaction({db,accountRef,orderRef,uid,requestFingerprint,order,pricePaise,publicPaperOrder,serverTimestamp}){
  if(!db||typeof db.runTransaction!=="function"||!accountRef||!orderRef||typeof uid!=="string"||!uid||typeof requestFingerprint!=="string"||!requestFingerprint||!order||order.uid!==uid||order.requestFingerprint!==requestFingerprint||typeof publicPaperOrder!=="function"||typeof serverTimestamp!=="function") throw new TypeError("Paper order transaction identity or dependencies are invalid.");
  let result;
  await db.runTransaction(async tx=>{
    const [accountSnap,existingOrder]=await Promise.all([tx.get(accountRef),tx.get(orderRef)]);
    if(existingOrder.exists){
      const prior=existingOrder.data();
      assertIdempotentReplay(prior,requestFingerprint);
      result=publicPaperOrder(prior,{orderId:orderRef.id,cashPaise:accountSnap.data()?.cashPaise,realizedPnlTotalPaise:accountSnap.data()?.realizedPnlPaise,idempotentReplay:true});
      return;
    }
    if(!accountSnap.exists) throw Object.assign(new Error("Paper account is not initialized."),{status:409});
    const next=buildPaperOrderUpdate(accountSnap.data(),{instrumentKey:order.instrumentKey,side:order.side,quantity:order.quantity,pricePaise});
    const storedOrder={...order,grossPaise:next.grossPaise,realizedPnlPaise:next.orderRealizedPnlPaise,createdAt:serverTimestamp()};
    tx.create(orderRef,storedOrder);
    tx.update(accountRef,{cashPaise:next.cashPaise,positions:next.positions,realizedPnlPaise:next.realizedPnlPaise,updatedAt:serverTimestamp(),version:next.version});
    result=publicPaperOrder(storedOrder,{orderId:orderRef.id,cashPaise:next.cashPaise,realizedPnlTotalPaise:next.realizedPnlPaise});
  });
  return result;
}
module.exports={executePaperOrderTransaction};