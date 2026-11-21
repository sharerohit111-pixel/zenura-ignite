"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {writeSseFrame,resumeUpstream,DEFAULT_MAX_FRAME_BYTES}=require("../lib/stream-backpressure");
function response(accepted){return {destroyed:false,writableEnded:false,writes:[],write(frame){this.writes.push(frame);return accepted;}};}
function socket(){return {readyState:1,paused:0,resumed:0,destroyed:false,pause(){this.paused++;},resume(){this.resumed++;}};}
function webSocket(transport=socket()){return {readyState:1,_socket:transport};}
test("pauses underlying WebSocket transport when downstream applies backpressure",()=>{
 const res=response(false),transport=socket();
 assert.equal(writeSseFrame(res,webSocket(transport),"event: market\ndata: {}\n\n"),false);
 assert.equal(transport.paused,1);
});
test("supports direct pause/resume adapters",()=>{
 const res=response(false),ws=socket();
 assert.equal(writeSseFrame(res,ws,"data: x\n\n"),false);
 assert.equal(ws.paused,1);
 assert.equal(resumeUpstream(ws),true);
 assert.equal(ws.resumed,1);
});
test("does not pause upstream when downstream accepts data",()=>{
 const res=response(true),transport=socket();
 assert.equal(writeSseFrame(res,webSocket(transport),"data: ok\n\n"),true);
 assert.equal(transport.paused,0);
});
test("resumes only an open, live upstream after downstream drain",()=>{
 const transport=socket(),ws=webSocket(transport);
 assert.equal(resumeUpstream(ws),true);
 assert.equal(transport.resumed,1);
 assert.equal(resumeUpstream(ws,true),false);
 assert.equal(resumeUpstream({...ws,readyState:3}),false);
 const destroyed=socket();destroyed.destroyed=true;
 assert.equal(resumeUpstream(webSocket(destroyed)),false);
 assert.equal(destroyed.resumed,0);
});
test("ignores writes after response closure",()=>{
 const res=response(true),transport=socket();res.destroyed=true;
 assert.equal(writeSseFrame(res,webSocket(transport),"data: x\n\n"),false);
 assert.equal(res.writes.length,0);
 assert.equal(transport.paused,0);
});
test("rejects oversized frames before buffering them",()=>{
 const res=response(true),transport=socket();
 assert.throws(()=>writeSseFrame(res,webSocket(transport),"x".repeat(DEFAULT_MAX_FRAME_BYTES+1)),{status:413});
 assert.equal(res.writes.length,0);
});
