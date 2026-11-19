"use strict";

const MAX_PROVIDER_JSON_BYTES=16*1024*1024;

async function readProviderJson(response,{maxBytes=MAX_PROVIDER_JSON_BYTES}={}){
 if(!response?.body||typeof response.body.getReader!=="function")
  throw Object.assign(new Error("Upstream provider response body is unavailable."),{status:502});
 const declared=Number(response.headers?.get?.("content-length"));
 if(Number.isFinite(declared)&&declared>maxBytes){
  await response.body.cancel?.().catch?.(()=>{});
  throw Object.assign(new Error("Upstream provider response exceeds the safe size limit."),{status:502});
 }
 const reader=response.body.getReader(),chunks=[];
 let total=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   if(!value)continue;
   total+=value.byteLength;
   if(total>maxBytes){
    await reader.cancel().catch(()=>{});
    throw Object.assign(new Error("Upstream provider response exceeds the safe size limit."),{status:502});
   }
   chunks.push(Buffer.from(value));
  }
 }finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(chunks,total).toString("utf8"));}
 catch{throw Object.assign(new Error("Upstream provider returned invalid JSON."),{status:502});}
}

module.exports={readProviderJson,MAX_PROVIDER_JSON_BYTES};
