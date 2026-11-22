"use strict";

const MAX_QUOTE_AGE_MS=15000;

function evaluateProtectiveOrder(order,quote,nowMs){
  if(!order||typeof order!=="object"||order.status!=="ACTIVE"
    ||!["EQUITY","FUTURE","OPTION"].includes(order.asset_class)
    ||!["DELIVERY","INTRADAY","FUTURES","OPTIONS"].includes(order.product)
    ||!["BUY","SELL"].includes(order.side)
    ||!["STOP_LOSS","TARGET"].includes(order.trigger_type)
    ||!["AT_OR_ABOVE","AT_OR_BELOW"].includes(order.trigger_direction)
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

module.exports={MAX_QUOTE_AGE_MS,evaluateProtectiveOrder};
