"use strict";
function calculateOptionExpiryPayoff({optionType,strikePricePaise,premiumPaise,underlyingPricePaise,lots,lotSize,side="BUY"}){
 const fail=message=>{throw Object.assign(new Error(message),{status:400});};
 if(!["CE","PE"].includes(optionType))fail("Expiry payoff is available only for CE and PE options.");
 if(!["BUY","SELL"].includes(side))fail("Option side must be BUY or SELL.");
 for(const [name,value] of Object.entries({strikePricePaise,premiumPaise,underlyingPricePaise,lotSize,lots})){
  if(!Number.isSafeInteger(value)||value<1)fail("Invalid "+name+" for option payoff calculation.");
 }
 if(lots>10000||lotSize>1000000)fail("Option contract quantity exceeds supported limits.");
 const quantity=lots*lotSize;
 if(!Number.isSafeInteger(quantity)||quantity>1000000)fail("Option contract quantity exceeds supported limits.");
 const intrinsicPerUnitPaise=optionType==="CE"
  ?Math.max(underlyingPricePaise-strikePricePaise,0)
  :Math.max(strikePricePaise-underlyingPricePaise,0);
 const premiumTotalPaise=premiumPaise*quantity;
 const intrinsicTotalPaise=intrinsicPerUnitPaise*quantity;
 if(!Number.isSafeInteger(premiumTotalPaise)||!Number.isSafeInteger(intrinsicTotalPaise))fail("Option payoff exceeds safe calculation limits.");
 const buyerPnlPaise=intrinsicTotalPaise-premiumTotalPaise;
 const pnlPaise=side==="BUY"?buyerPnlPaise:-buyerPnlPaise;
 const breakEvenPricePaise=optionType==="CE"
  ?strikePricePaise+premiumPaise
  :strikePricePaise-premiumPaise;
 if(!Number.isSafeInteger(pnlPaise)||!Number.isSafeInteger(breakEvenPricePaise))fail("Option payoff exceeds safe calculation limits.");
 return {
  optionType,side,lots,lotSize,quantity,strikePricePaise,premiumPaise,underlyingPricePaise,
  intrinsicPerUnitPaise,intrinsicTotalPaise,premiumTotalPaise,breakEvenPricePaise,
  grossPnlPaise:pnlPaise,maximumBuyerLossPaise:premiumTotalPaise,
  valuation:"expiry_intrinsic_only",excludesCharges:true,simulationOnly:true
 };
}
module.exports={calculateOptionExpiryPayoff};
