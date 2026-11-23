"use strict";

const MAX_QUOTE_AGE_MS=15000;

function isSupportedProtectiveOrder(order){
  if(!order||typeof order!=="object")return false;
  const productByAsset={EQUITY:["DELIVERY","INTRADAY"],FUTURE:["FUTURES"],OPTION:["OPTIONS"]};
  if(!productByAsset[order.asset_class]?.includes(order.product))return false;
  if(!["BUY","SELL"].includes(order.side)||!["STOP_LOSS","TARGET"].includes(order.trigger_type))return false;
  // For a closing order, stop-loss and target directions depend on the held side.
  const expectedDirection=order.trigger_type==="STOP_LOSS"
    ?(order.side==="SELL"?"AT_OR_BELOW":"AT_OR_ABOVE")
    :(order.side==="SELL"?"AT_OR_ABOVE":"AT_OR_BELOW");
  return order.trigger_direction===expectedDirection;
}

function isPositionCloseable(order,position){
  if(!isSupportedProtectiveOrder(order)||!position||typeof position!=="object"
    ||!Number.isSafeInteger(order.quantity)||order.quantity<1||order.quantity>1000000)return false;
  if(position.instrument_key!==order.instrument_key)return false;
  if(order.asset_class==="EQUITY"){
    if(position.product!==order.product||!Number.isSafeInteger(position.quantity)
      ||!Number.isSafeInteger(position.reserved_quantity)||position.quantity<1
      ||position.reserved_quantity<0||position.reserved_quantity>position.quantity)return false;
    const closeSide=order.side==="SELL";
    return closeSide&&order.quantity<=position.quantity-position.reserved_quantity;
  }
  if(order.asset_class==="FUTURE"){
    if(!["INTRADAY","DELIVERY"].includes(position.product)||!Number.isSafeInteger(position.net_quantity)
      ||position.net_quantity===0)return false;
    return order.quantity<=Math.abs(position.net_quantity)
      &&((position.net_quantity>0&&order.side==="SELL")||(position.net_quantity<0&&order.side==="BUY"));
  }
  if(position.net_quantity!==undefined){
    return order.side==="SELL"&&Number.isSafeInteger(position.net_quantity)
      &&position.net_quantity>0&&order.quantity<=position.net_quantity;
  }
  return false;
}

function evaluateProtectiveOrder(order,quote,nowMs){
  if(!order||typeof order!=="object"||order.status!=="ACTIVE"
    ||!isSupportedProtectiveOrder(order)
    ||typeof order.order_id!=="string"||!order.order_id
    ||typeof order.user_id!=="string"||!order.user_id
    ||typeof order.instrument_key!=="string"||!order.instrument_key
    ||!Number.isSafeInteger(order.trigger_price_paise)||order.trigger_price_paise<1
    ||!Number.isSafeInteger(order.quantity)||order.quantity<1||order.quantity>1000000
    ||!quote||quote.instrumentKey!==order.instrument_key
    ||!Number.isSafeInteger(quote.pricePaise)||quote.pricePaise<1
    ||!Number.isSafeInteger(quote.tradeTimeMs)||quote.tradeTimeMs<1
    ||!Number.isSafeInteger(nowMs)||nowMs<1||quote.tradeTimeMs>nowMs
    ||nowMs-quote.tradeTimeMs>MAX_QUOTE_AGE_MS)return false;
  return order.trigger_direction==="AT_OR_ABOVE"
    ?quote.pricePaise>=order.trigger_price_paise
    :quote.pricePaise<=order.trigger_price_paise;
}

module.exports={MAX_QUOTE_AGE_MS,evaluateProtectiveOrder,isSupportedProtectiveOrder,isPositionCloseable};
