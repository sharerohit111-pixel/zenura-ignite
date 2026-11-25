"use strict";
const {normalizeProviderQuote}=require("./provider-quote");
const {quoteAgeMs}=require("./quote-freshness");
const {getProductPositionFieldNames}=require("./product-mode");

function readStoredPaperPositions(account,product){
  const fields=getProductPositionFieldNames(product);
  if(!fields)throw Object.assign(new Error("Invalid paper product mode."),{status:400});
  const positions=account?.[fields.positionsField];
  if(!account||typeof account!=="object"||Array.isArray(account)||(positions!==undefined&&(!positions||typeof positions!=="object"||Array.isArray(positions))))
    throw Object.assign(new Error("Paper account contains an invalid cash-equity positions map."),{status:409});
  return Object.entries(positions||{});
}

function buildPortfolioValuation({positions,quotes,cashPaise,realizedPnlPaise=0,instruments=[],now=Date.now(),maxAgeMs=60000}){
  if(!Array.isArray(positions)||!Array.isArray(quotes)||!Array.isArray(instruments)||!Number.isSafeInteger(cashPaise)||cashPaise<0||!Number.isSafeInteger(realizedPnlPaise)||!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<0)
    throw Object.assign(new Error("Invalid portfolio valuation input."),{status:409});
  if(positions.length>50)throw Object.assign(new Error("Portfolio contains more than 50 open positions."),{status:409});
  let marketValuePaise=0,unrealizedPnlPaise=0,staleCount=0;
  const valued=[];
  for(const [instrumentKey,position] of positions){
    if(typeof instrumentKey!=="string"||!instrumentKey||!position||!Number.isSafeInteger(position.quantity)||position.quantity<1||position.quantity>1000000||!Number.isSafeInteger(position.averagePricePaise)||position.averagePricePaise<1)
      throw Object.assign(new Error("Portfolio contains an invalid position."),{status:409});
    const legacyCost=position.quantity*position.averagePricePaise;
    const costBasisPaise=position.costBasisPaise===undefined?legacyCost:position.costBasisPaise;
    if(!Number.isSafeInteger(legacyCost)||!Number.isSafeInteger(costBasisPaise)||costBasisPaise<1||
       Math.round(costBasisPaise/position.quantity)!==position.averagePricePaise)
      throw Object.assign(new Error("Portfolio contains an invalid cost basis."),{status:409});
    const instrument=instruments.find(x=>x?.instrument_key===instrumentKey);
    const quote=quotes.find(x=>x?.instrument_token===instrumentKey);
    let normalized=null;
    try{normalized=normalizeProviderQuote(quote,instrumentKey,{now,maxAgeMs});}catch(_){}
    if(!normalized){
      staleCount++;
      const age=quoteAgeMs(quote?.last_trade_time,now);
      valued.push({instrumentKey,tradingSymbol:instrument?.trading_symbol||instrumentKey,quantity:position.quantity,averagePricePaise:position.averagePricePaise,costBasisPaise,lastPricePaise:null,marketValuePaise:null,unrealizedPnlPaise:null,quoteAgeMs:Number.isFinite(age)?age:null,valuationStatus:"stale_or_unavailable"});
      continue;
    }
    const {pricePaise:lastPricePaise,quoteAgeMs:age}=normalized;
    const value=lastPricePaise*position.quantity,pnl=value-costBasisPaise;
    if(!Number.isSafeInteger(value)||!Number.isSafeInteger(pnl)||!Number.isSafeInteger(marketValuePaise+value)||!Number.isSafeInteger(unrealizedPnlPaise+pnl))
      throw Object.assign(new Error("Portfolio valuation exceeds safe calculation limits."),{status:409});
    marketValuePaise+=value;unrealizedPnlPaise+=pnl;
    valued.push({instrumentKey,tradingSymbol:instrument?.trading_symbol||quote.symbol||instrumentKey,quantity:position.quantity,averagePricePaise:position.averagePricePaise,costBasisPaise,lastPricePaise,marketValuePaise:value,unrealizedPnlPaise:pnl,quoteAgeMs:age,valuationStatus:"fresh"});
  }
  const equityPaise=cashPaise+marketValuePaise;
  if(!Number.isSafeInteger(equityPaise))throw Object.assign(new Error("Portfolio equity exceeds safe calculation limits."),{status:409});
  return {positions:valued,cashPaise,marketValuePaise,unrealizedPnlPaise,equityPaise,realizedPnlPaise,valuationStatus:staleCount?"partial_stale":positions.length?"fresh":"no_open_positions",stalePositions:staleCount,simulationOnly:true};
}
module.exports={buildPortfolioValuation,readStoredPaperPositions};
