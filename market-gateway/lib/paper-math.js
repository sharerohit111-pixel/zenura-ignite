"use strict";

function calculatePaperFill({side,quantity,pricePaise,cashPaise,realizedPnlPaise=0,position={quantity:0,averagePricePaise:0}}){
  if(!["BUY","SELL"].includes(side))throw Object.assign(new Error("Only BUY and SELL are supported."),{status:400});
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)throw Object.assign(new Error("Invalid quantity."),{status:400});
  if(!Number.isSafeInteger(pricePaise)||pricePaise<1)throw Object.assign(new Error("Invalid execution price."),{status:400});
  if(!Number.isSafeInteger(cashPaise)||cashPaise<0||!Number.isSafeInteger(realizedPnlPaise)||realizedPnlPaise<0)throw Object.assign(new Error("Invalid account balance."),{status:409});
  const current={quantity:position.quantity,averagePricePaise:position.averagePricePaise};
  if(!Number.isSafeInteger(current.quantity)||current.quantity<0||current.quantity>1000000||!Number.isSafeInteger(current.averagePricePaise)||current.averagePricePaise<0)
    throw Object.assign(new Error("Invalid existing position."),{status:409});
  const grossPaise=pricePaise*quantity;
  if(!Number.isSafeInteger(grossPaise)||grossPaise<=0)throw Object.assign(new Error("Order value exceeds supported calculation limits."),{status:400});
  let cash=cashPaise,realized=realizedPnlPaise,orderRealized=0,nextPosition={...current};
  if(side==="BUY"){
    if(cash<grossPaise)throw Object.assign(new Error("Insufficient virtual cash balance."),{status:409});
    const nextQty=current.quantity+quantity,existingCost=current.quantity*current.averagePricePaise,weightedCost=existingCost+grossPaise;
    if(!Number.isSafeInteger(existingCost))throw Object.assign(new Error("Existing position cost exceeds safe limits."),{status:409});
    if(!Number.isSafeInteger(nextQty)||nextQty>1000000||!Number.isSafeInteger(weightedCost))throw Object.assign(new Error("Position cost exceeds safe limits."),{status:409});
    const average=Math.round(weightedCost/nextQty),nextCash=cash-grossPaise;
    if(!Number.isSafeInteger(average)||!Number.isSafeInteger(nextCash)||nextCash<0)throw Object.assign(new Error("BUY exceeds safe account limits."),{status:409});
    nextPosition={quantity:nextQty,averagePricePaise:average};cash=nextCash;
  }else{
    if(current.quantity<quantity)throw Object.assign(new Error("Not enough shares in the virtual portfolio to sell."),{status:409});
    if(current.quantity===0||current.averagePricePaise<1)throw Object.assign(new Error("Cannot sell a position without a valid average cost."),{status:409});
    orderRealized=(pricePaise-current.averagePricePaise)*quantity;
    const nextCash=cash+grossPaise,nextRealized=realized+orderRealized;
    if(!Number.isSafeInteger(orderRealized)||!Number.isSafeInteger(nextCash)||!Number.isSafeInteger(nextRealized))throw Object.assign(new Error("SELL exceeds safe account limits."),{status:409});
    nextPosition={quantity:current.quantity-quantity,averagePricePaise:current.averagePricePaise};cash=nextCash;realized=nextRealized;
  }
  return {cashPaise:cash,realizedPnlPaise:realized,orderRealizedPnlPaise:orderRealized,grossPaise,position:nextPosition};
}
module.exports={calculatePaperFill};
