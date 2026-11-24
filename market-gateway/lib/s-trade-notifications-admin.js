"use strict";

const PRICE_CONDITIONS=new Set(["above","below"]);
const PROVIDERS=new Set(["upstox"]);
const ADMIN_ACTIONS=new Set(["user_suspend","user_restore","provider_control","orders_control","price_alerts_control"]);

function normalizePriceAlert(input){
  if(!input||typeof input!=="object"||Array.isArray(input))throw Object.assign(new Error("Invalid price alert"),{status:400});
  const instrumentKey=typeof input.instrumentKey==="string"?input.instrumentKey.trim():"";
  const symbol=typeof input.symbol==="string"?input.symbol.trim():"";
  const condition=input.condition;
  const target=Number(input.targetPrice);
  if(!instrumentKey||instrumentKey.length>100||/[\r\n]/.test(instrumentKey)
    ||!symbol||symbol.length>40||/[\r\n]/.test(symbol)
    ||!PRICE_CONDITIONS.has(condition)||!Number.isFinite(target)||target<=0||target>=1e12){
    throw Object.assign(new Error("Price alert fields are invalid"),{status:400});
  }
  return {instrument_key:instrumentKey,display_symbol:symbol,condition,target_price:target};
}
function normalizePreferences(input){
  const allowed=["trade_confirmations","order_alerts","price_alerts","security_alerts","email_enabled","push_enabled"];
  if(!input||typeof input!=="object"||Array.isArray(input)
    ||Object.keys(input).some(key=>!allowed.includes(key))
    ||Object.values(input).some(value=>typeof value!=="boolean")){
    throw Object.assign(new Error("Notification preferences must contain only supported boolean fields"),{status:400});
  }
  return Object.freeze({...input});
}
function safeAdminReason(value){
  const reason=typeof value==="string"?value.trim():"";
  if(reason.length<8||reason.length>500)return null;
  return reason;
}
function isProvider(value){return PROVIDERS.has(value);}
function isAdminAction(value){return ADMIN_ACTIONS.has(value);}

module.exports={normalizePriceAlert,normalizePreferences,safeAdminReason,isProvider,isAdminAction};
