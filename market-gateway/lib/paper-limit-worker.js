"use strict";

function isEligiblePaperLimitOrder(order,quote,nowMs){
  if(!order||typeof order!=="object"||order.order_type!=="LIMIT"||order.status!=="PENDING"
     ||order.simulation_only!==true||order.product!=="DELIVERY"
     ||typeof order.user_id!=="string"||!order.user_id
     ||typeof order.instrument_key!=="string"||!order.instrument_key
     ||!["BUY","SELL"].includes(order.side)
     ||!Number.isSafeInteger(order.quantity)||order.quantity<1||order.quantity>1000000
     ||!Number.isSafeInteger(order.limit_price_paise)||order.limit_price_paise<1
     ||!quote||!Number.isSafeInteger(quote.pricePaise)||quote.pricePaise<1
     ||!Number.isSafeInteger(quote.tradeTimeMs)||quote.tradeTimeMs<1
     ||!Number.isSafeInteger(nowMs)||nowMs<1||quote.tradeTimeMs>nowMs
     ||nowMs-quote.tradeTimeMs>15000)return false;
  return order.side==="BUY"
    ? quote.pricePaise<=order.limit_price_paise
    : quote.pricePaise>=order.limit_price_paise;
}

function normalizeWorkerCursor(state){
  if(!state||typeof state!=="object")return {createdAt:null,orderId:null};
  const createdAt=typeof state.cursor_created_at==="string"&&Number.isFinite(Date.parse(state.cursor_created_at))
    ?state.cursor_created_at:null;
  const orderId=typeof state.cursor_order_id==="string"&&/^[a-f0-9]{64}$/.test(state.cursor_order_id)
    ?state.cursor_order_id:null;
  return createdAt&&orderId?{createdAt,orderId}:{createdAt:null,orderId:null};
}

function groupOrdersByUser(orders){
  const groups=new Map();
  for(const order of Array.isArray(orders)?orders:[]){
    if(!order||typeof order.user_id!=="string"||!order.user_id)continue;
    if(!groups.has(order.user_id))groups.set(order.user_id,[]);
    groups.get(order.user_id).push(order);
  }
  return groups;
}


function isEligibleCryptoLimitOrder(order,quote,nowMs){
  if(!order||typeof order!=="object"||order.order_type!=="LIMIT"||order.status!=="PENDING"
     ||order.simulation_only!==true||!/^([A-Z0-9]{2,12})USDT$/.test(order.symbol||"")
     ||typeof order.user_id!=="string"||!order.user_id
     ||!["BUY","SELL"].includes(order.side)
     ||!Number.isFinite(Number(order.quantity))||Number(order.quantity)<=0||!Number.isFinite(Number(order.limit_price))||Number(order.limit_price)<=0
     ||!quote||!Number.isFinite(quote.priceUsdt)||quote.priceUsdt<=0
     ||!Number.isSafeInteger(quote.tradeTimeMs)||quote.tradeTimeMs<1
     ||!Number.isSafeInteger(nowMs)||nowMs<1||quote.tradeTimeMs>nowMs
     ||nowMs-quote.tradeTimeMs>15000)return false;
  return order.side==="BUY"
    ? quote.priceUsdt<=Number(order.limit_price)
    : quote.priceUsdt>=Number(order.limit_price);
}

module.exports={isEligiblePaperLimitOrder,isEligibleCryptoLimitOrder,normalizeWorkerCursor,groupOrdersByUser};
