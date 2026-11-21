"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {parseSseChunk}=require("./sse-parser");
test("parses an event split across arbitrary chunks",()=>{
 let state=parseSseChunk("","event: market\r");
 state=parseSseChunk(state.buffer,"\ndata: {\"ltp\":12}\r\n\r");
 state=parseSseChunk(state.buffer,"\n");
 assert.deepEqual(state.events,[{event:"market",data:"{\"ltp\":12}"}]);
 assert.equal(state.buffer,"");
});
test("joins multiple data lines and ignores comments",()=>{
 const result=parseSseChunk("",": keepalive\nevent: market\ndata: first\ndata: second\n\n");
 assert.deepEqual(result.events,[{event:"market",data:"first\nsecond"}]);
});
test("defaults missing event name to message and ignores data-less blocks",()=>{
 const result=parseSseChunk("","event: status\n\n data\n\ndata: ok\n\n");
 assert.deepEqual(result.events,[{event:"message",data:"ok"}]);
});
test("dispatches a final unterminated event at end of stream",()=>{
 const result=parseSseChunk("","event: status\ndata: {\"connected\":true}",{final:true});
 assert.deepEqual(result.events,[{event:"status",data:"{\"connected\":true}"}]);
 assert.equal(result.buffer,"");
});
test("keeps incomplete event until the next chunk",()=>{
 const first=parseSseChunk("","event: market\ndata: {");
 assert.deepEqual(first.events,[]);
 assert.equal(first.buffer,"event: market\ndata: {");
 const second=parseSseChunk(first.buffer,"\"ok\":true}\n\n");
 assert.deepEqual(second.events,[{event:"market",data:"{\"ok\":true}"}]);
});
test("rejects oversized event buffers",()=>{
 assert.throws(()=>parseSseChunk("123","456",{maxBuffer:5}),/buffer limit/);
});
