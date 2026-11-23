"use strict";

const SAFE_ORDER_ID=/^[A-Za-z0-9_-]{1,128}$/;
const ISO_TIMESTAMP=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function encodeHistoryCursor(row){
 if(!row||typeof row.created_at!=="string"||!SAFE_ORDER_ID.test(String(row.order_id||"")))
  throw new TypeError("Cannot encode an invalid order history cursor.");
 return Buffer.from(JSON.stringify({createdAt:row.created_at,orderId:String(row.order_id)}),"utf8").toString("base64url");
}
function decodeHistoryCursor(value){
 if(value===undefined||value===null||value==="")return {ok:true,cursor:null};
 if(typeof value!=="string"||value.length>512||!/^[A-Za-z0-9_-]+$/.test(value))return {ok:false,cursor:null};
 try{
  const decoded=JSON.parse(Buffer.from(value,"base64url").toString("utf8"));
  if(!decoded||typeof decoded!=="object"||Array.isArray(decoded)||
     typeof decoded.createdAt!=="string"||!ISO_TIMESTAMP.test(decoded.createdAt)||
     !Number.isFinite(Date.parse(decoded.createdAt))||
     typeof decoded.orderId!=="string"||!SAFE_ORDER_ID.test(decoded.orderId))
   return {ok:false,cursor:null};
  return {ok:true,cursor:{createdAt:decoded.createdAt,orderId:decoded.orderId}};
 }catch(_){return {ok:false,cursor:null};}
}
function applyHistoryCursor(query,cursor){
 if(!cursor)return query;
 return query.or("created_at.lt."+cursor.createdAt+",and(created_at.eq."+cursor.createdAt+",order_id.lt."+cursor.orderId+")");
}
function paginateHistoryRows(rows,limit){
 const page=rows.slice(0,limit),hasMore=rows.length>limit;
 return {rows:page,hasMore,nextCursor:hasMore&&page.length?encodeHistoryCursor(page[page.length-1]):null};
}
module.exports={encodeHistoryCursor,decodeHistoryCursor,applyHistoryCursor,paginateHistoryRows};
