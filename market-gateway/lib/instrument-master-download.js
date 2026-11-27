"use strict";
const {gunzipSync}=require("node:zlib");

const MAX_COMPRESSED_BYTES=64*1024*1024;
const MAX_DECOMPRESSED_BYTES=256*1024*1024;

async function readBoundedBody(response,{maxCompressedBytes=MAX_COMPRESSED_BYTES}={}){
 if(!response?.body||typeof response.body.getReader!=="function")
  throw new Error("Instrument master response body is unavailable.");
 const reader=response.body.getReader(),chunks=[];
 let total=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   if(!value)continue;
   total+=value.byteLength;
   if(total>maxCompressedBytes){
    await reader.cancel().catch(()=>{});
    throw new Error("Instrument master compressed download exceeds the safe size limit.");
   }
   chunks.push(Buffer.from(value));
  }
 }finally{
  reader.releaseLock();
 }
 return Buffer.concat(chunks,total);
}

async function downloadInstrumentMaster(response,{
 maxCompressedBytes=MAX_COMPRESSED_BYTES,
 maxDecompressedBytes=MAX_DECOMPRESSED_BYTES
}={}){
 if(!response?.ok)throw new Error("Upstox instrument master download failed.");
 const compressed=await readBoundedBody(response,{maxCompressedBytes});
 let json;
 try{
  json=gunzipSync(compressed,{maxOutputLength:maxDecompressedBytes}).toString("utf8");
 }catch(error){
  if(error?.code==="ERR_BUFFER_TOO_LARGE")
   throw new Error("Instrument master decompressed data exceeds the safe size limit.");
  throw new Error("Instrument master gzip payload is invalid.");
 }
 try{return JSON.parse(json);}
 catch{throw new Error("Instrument master JSON payload is invalid.");}
}
module.exports={downloadInstrumentMaster,MAX_COMPRESSED_BYTES,MAX_DECOMPRESSED_BYTES};
