"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {gzipSync}=require("node:zlib");
const {downloadInstrumentMaster}=require("../lib/instrument-master-download");

function responseFor(bytes,{ok=true,chunkSize=4}={}){
 const chunks=[];
 for(let i=0;i<bytes.length;i+=chunkSize)chunks.push(bytes.subarray(i,i+chunkSize));
 let index=0;
 return {ok,body:{getReader(){return {
  async read(){return index<chunks.length?{done:false,value:chunks[index++]}:{done:true};},
  async cancel(){index=chunks.length;},
  releaseLock(){}
 };}}};
}
test("downloads and parses a valid compressed instrument master",async()=>{
 const bytes=gzipSync(Buffer.from(JSON.stringify([{instrument_key:"NSE_EQ|INE000000000",segment:"NSE_EQ"}])));
 assert.deepEqual(await downloadInstrumentMaster(responseFor(bytes)),[{instrument_key:"NSE_EQ|INE000000000",segment:"NSE_EQ"}]);
});
test("rejects a compressed response that exceeds its byte budget while streaming",async()=>{
 const bytes=gzipSync(Buffer.from(JSON.stringify({payload:"123456789"})));
 await assert.rejects(downloadInstrumentMaster(responseFor(bytes),{maxCompressedBytes:8}),/compressed download exceeds/);
});
test("rejects a decompression bomb beyond the output budget",async()=>{
 const bytes=gzipSync(Buffer.from("x".repeat(4096)));
 await assert.rejects(downloadInstrumentMaster(responseFor(bytes),{maxDecompressedBytes:128}),/decompressed data exceeds/);
});
test("rejects failed, malformed gzip, and malformed JSON responses",async()=>{
 await assert.rejects(downloadInstrumentMaster(responseFor(Buffer.from(""),{ok:false})),/download failed/);
 await assert.rejects(downloadInstrumentMaster(responseFor(Buffer.from("not gzip"))),/gzip payload is invalid/);
 await assert.rejects(downloadInstrumentMaster(responseFor(gzipSync(Buffer.from("{bad")))),/JSON payload is invalid/);
});
