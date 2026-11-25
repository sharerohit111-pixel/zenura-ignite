(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 if(root)root.ZENURA_DERIVATIVE_POSITION=api;
})(typeof window!=="undefined"?window:globalThis,function(){
 "use strict";
 function applyDerivativeFill({instrumentType,side,quantity,pricePaise,position={netQuantity:0,averagePricePaise:0},now=Date.now()}){
 const fail=message=>{throw Object.assign(new Error(message),{status:400});};
 if(!["FUT","CE","PE"].includes(instrumentType))fail("Only futures and options positions are supported.");
 if(!["BUY","SELL"].includes(side))fail("Side must be BUY or SELL.");
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)fail("Invalid derivative fill quantity.");
 if(!Number.isSafeInteger(pricePaise)||pricePaise<1)fail("Invalid derivative fill price.");
 if(!Number.isSafeInteger(now)||now<0)fail("Invalid execution timestamp.");
 if(!position||!Number.isSafeInteger(position.netQuantity)||Math.abs(position.netQuantity)>1000000||!Number.isSafeInteger(position.averagePricePaise)||position.averagePricePaise<0||(position.netQuantity!==0&&position.averagePricePaise<1)||(position.netQuantity===0&&position.averagePricePaise!==0))fail("Existing derivative position is invalid.");
 const signedFill=side==="BUY"?quantity:-quantity;
 const oldQty=position.netQuantity,newQty=oldQty+signedFill;
 if(!Number.isSafeInteger(newQty)||Math.abs(newQty)>1000000)fail("Derivative position quantity exceeds supported limits.");
 let realizedPnlPaise=0,closedQuantity=0,openedQuantity=0,nextAverage=position.averagePricePaise;
 if(oldQty===0||Math.sign(oldQty)===Math.sign(signedFill)){
  const oldCost=Math.abs(oldQty)*position.averagePricePaise,fillCost=quantity*pricePaise,totalCost=oldCost+fillCost,totalQty=Math.abs(newQty);
  if(!Number.isSafeInteger(oldCost)||!Number.isSafeInteger(fillCost)||!Number.isSafeInteger(totalCost))fail("Derivative position cost exceeds safe calculation limits.");
  nextAverage=Math.round(totalCost/totalQty);openedQuantity=quantity;
 }else{
  closedQuantity=Math.min(Math.abs(oldQty),quantity);
  const perUnit=oldQty>0?pricePaise-position.averagePricePaise:position.averagePricePaise-pricePaise;
  realizedPnlPaise=perUnit*closedQuantity;
  if(!Number.isSafeInteger(realizedPnlPaise))fail("Realized derivative P&L exceeds safe calculation limits.");
  if(newQty===0)nextAverage=0;
  else if(Math.sign(newQty)!==Math.sign(oldQty)){nextAverage=pricePaise;openedQuantity=Math.abs(newQty);}
 }
 const optionPremiumCashDeltaPaise=instrumentType==="FUT"?0:-signedFill*pricePaise;
 const futuresSettlementCashDeltaPaise=instrumentType==="FUT"?realizedPnlPaise:0;
 const cashDeltaPaise=optionPremiumCashDeltaPaise+futuresSettlementCashDeltaPaise;
 if(!Number.isSafeInteger(cashDeltaPaise))fail("Derivative cash movement exceeds safe calculation limits.");
 return {instrumentType,netQuantity:newQty,averagePricePaise:nextAverage,realizedPnlPaise,closedQuantity,openedQuantity,cashDeltaPaise,optionPremiumCashDeltaPaise,futuresSettlementCashDeltaPaise,positionStatus:newQty===0?"CLOSED":newQty>0?"LONG":"SHORT",simulationOnly:true,excludesCharges:true,executedAtMs:now};
}
return Object.freeze({applyDerivativeFill});
});
