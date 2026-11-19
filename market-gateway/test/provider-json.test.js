"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {readProviderJson}=require("../lib/provider-json");

function responseFor(bytes,{chunkSize=3,contentLength}={}){
 const chunks=[];
 for(let i=0;i<bytes.length;i+=chunkSize)chunks.push(bytes.subarray(i,i+chunkSize));
 let index=0;
 return {headers:{get(name){return name.toLowerCase()==="content-length"&&contentLength!==undefined?String(contentLength):null;}},body:{getReader(){return {
  async read(){return index<chunks.length?{done:false,value:chunks[index++]}:{done:true};},
  async cancel(){index=chunks.length;},
  releaseLock(){}
 };}}};
}
test("reads bounded provider JSON",async()=>{
 assert.deepEqual(await readProviderJson(responseFor(Buffer.from('{"ok":true}'))),{ok:true});
});
test("rejects declared response larger than budget",async()=>{
 await assert.rejects(readProviderJson(responseFor(Buffer.from("{}"),{contentLength:100}),{maxBytes:8}),e=>e.status===502&&/size limit/.test(e.message));
});
test("rejects streamed response larger than budget",async()=>{
 await assert.rejects(readProviderJson(responseFor(Buffer.from('{"data":"123456789"}')),{maxBytes:8}),e=>e.status===502&&/size limit/.test(e.message));
});
test("rejects invalid provider JSON instead of returning a successful null payload",async()=>{
 await assert.rejects(readProviderJson(responseFor(Buffer.from("{bad"))),e=>e.status===502&&/invalid JSON/.test(e.message));
});
