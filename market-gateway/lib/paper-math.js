"use strict";

function fail(message,status=409){throw Object.assign(new Error(message),{status});}
function calculatePaperFill({side,quantity,pricePaise,cashPaise,realizedPnlPaise=0,position={quantity:0,averagePricePaise:0}}){
  if(!["BUY","SELL"].includes(side))fail("Only BUY and SELL are supported.",400);
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)fail("Invalid quantity.",400);
  if(!Number.isSafeInteger(pricePaise)||pricePaise<1)fail("Invalid execution price.",400);
  if(!Number.isSafeInteger(cashPaise)||cashPaise<0||!Number.isSafeInteger(realizedPnlPaise))fail("Invalid account balance.");
  const current={quantity:position.quantity,averagePricePaise:position.averagePricePaise};
  if(!Number.isSafeInteger(current.quantity)||current.quantity<0||current.quantity>1000000||!Number.isSafeInteger(current.averagePricePaise)||current.averagePricePaise<0)
    fail("Invalid existing position.");
  const legacyCost=current.quantity*current.averagePricePaise;
  const costBasisPaise=position.costBasisPaise===undefined?legacyCost:position.costBasisPaise;
  if(!Number.isSafeInteger(legacyCost)||!Number.isSafeInteger(costBasisPaise)||costBasisPaise<0||
     (current.quantity>0&&costBasisPaise<1)||(current.quantity===0&&costBasisPaise!==0)||
     (current.quantity>0&&Math.round(costBasisPaise/current.quantity)!==current.averagePricePaise))
    fail("Invalid existing position cost basis.");
  const grossPaise=pricePaise*quantity;
  if(!Number.isSafeInteger(grossPaise)||grossPaise<=0)fail("Order value exceeds supported calculation limits.",400);
  let cash=cashPaise,realized=realizedPnlPaise,orderRealized=0,nextPosition={...current,costBasisPaise};
  if(side==="BUY"){
    if(cash<grossPaise)fail("Insufficient virtual cash balance.");
    const nextQty=current.quantity+quantity,nextCost=costBasisPaise+grossPaise;
    if(!Number.isSafeInteger(nextQty)||nextQty>1000000||!Number.isSafeInteger(nextCost))fail("Position cost exceeds safe limits.");
    const average=Math.round(nextCost/nextQty),nextCash=cash-grossPaise;
    if(!Number.isSafeInteger(average)||!Number.isSafeInteger(nextCash)||nextCash<0)fail("BUY exceeds safe account limits.");
    nextPosition={quantity:nextQty,averagePricePaise:average,costBasisPaise:nextCost};cash=nextCash;
  }else{
    if(current.quantity<quantity)fail("Not enough shares in the virtual portfolio to sell.");
    if(current.quantity===0||current.averagePricePaise<1)fail("Cannot sell a position without a valid average cost.");
    const allocatedCost=quantity===current.quantity?costBasisPaise:
      Number((BigInt(costBasisPaise)*BigInt(quantity)+BigInt(Math.floor(current.quantity/2)))/BigInt(current.quantity));
    const remainingCost=costBasisPaise-allocatedCost;
    orderRealized=grossPaise-allocatedCost;
    const nextCash=cash+grossPaise,nextRealized=realized+orderRealized;
    if(!Number.isSafeInteger(allocatedCost)||!Number.isSafeInteger(remainingCost)||!Number.isSafeInteger(orderRealized)||!Number.isSafeInteger(nextCash)||!Number.isSafeInteger(nextRealized))
      fail("SELL exceeds safe account limits.");
    const remainingQty=current.quantity-quantity;
    nextPosition=remainingQty?{quantity:remainingQty,averagePricePaise:Math.round(remainingCost/remainingQty),costBasisPaise:remainingCost}:{quantity:0,averagePricePaise:0,costBasisPaise:0};
    cash=nextCash;realized=nextRealized;
  }
  return {cashPaise:cash,realizedPnlPaise:realized,orderRealizedPnlPaise:orderRealized,grossPaise,position:nextPosition};
}
module.exports={calculatePaperFill};
