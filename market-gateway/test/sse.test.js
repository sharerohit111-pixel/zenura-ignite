"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {formatSseEvent,formatSseComment}=require("../lib/sse");
test("formats named SSE events with JSON data and a blank-line terminator",()=>{
 assert.equal(formatSseEvent("market",{ltp:123}),"event: market\ndata: {\"ltp\":123}\n\n");
});
test("formats heartbeat comments using actual SSE line delimiters",()=>{
 assert.equal(formatSseComment("keep-alive"),": keep-alive\n\n");
});
test("rejects invalid event names and multiline comments",()=>{
 assert.throws(()=>formatSseEvent("bad\nevent",{}),TypeError);
 assert.throws(()=>formatSseComment("x\ny"),TypeError);
});
