"use strict";

const ORDER_ID_PATTERN=/^[a-f0-9]{64}$/;
const TIMESTAMP_PATTERN=/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$/;
const MAX_CURSOR_LENGTH=512;

function isValidTimestamp(value){
  return typeof value==="string"&&TIMESTAMP_PATTERN.test(value)&&Number.isFinite(Date.parse(value));
}
function encodeOrderHistoryCursor(order){
  if(!order||!isValidTimestamp(order.created_at)||typeof order.order_id!=="string"||!ORDER_ID_PATTERN.test(order.order_id))
    throw new TypeError("A valid order timestamp and order ID are required.");
  return Buffer.from(JSON.stringify({createdAt:order.created_at,orderId:order.order_id}),"utf8").toString("base64url");
}
function decodeOrderHistoryCursor(value){
  if(typeof value!=="string"||value.length<1||value.length>MAX_CURSOR_LENGTH||!/^[A-Za-z0-9_-]+$/.test(value))
    throw new TypeError("Order history cursor is invalid.");
  let parsed;
  try{
    const decoded=Buffer.from(value,"base64url");
    if(decoded.toString("base64url")!==value)throw new Error("Non-canonical cursor");
    parsed=JSON.parse(decoded.toString("utf8"));
  }catch(_){throw new TypeError("Order history cursor is invalid.");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)
    ||Object.keys(parsed).length!==2||!Object.hasOwn(parsed,"createdAt")||!Object.hasOwn(parsed,"orderId")
    ||!isValidTimestamp(parsed.createdAt)||typeof parsed.orderId!=="string"||!ORDER_ID_PATTERN.test(parsed.orderId))
    throw new TypeError("Order history cursor is invalid.");
  return Object.freeze({createdAt:parsed.createdAt,orderId:parsed.orderId});
}
function buildOrderHistoryCursorFilter(cursor){
  if(!cursor||!isValidTimestamp(cursor.createdAt)||typeof cursor.orderId!=="string"||!ORDER_ID_PATTERN.test(cursor.orderId))
    throw new TypeError("A validated order history cursor is required.");
  return "created_at.lt."+cursor.createdAt+",and(created_at.eq."+cursor.createdAt+",order_id.lt."+cursor.orderId+")";
}
module.exports={encodeOrderHistoryCursor,decodeOrderHistoryCursor,buildOrderHistoryCursorFilter};
