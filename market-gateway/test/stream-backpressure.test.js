"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {writeSseFrame,resumeUpstream,DEFAULT_MAX_FRAME_BYTES}=require("../lib/stream-backpressure");
function response(accepted){return {destroyed:false,writableEnded:false,writes:[],write(frame){this.writes.push(frame);return accepted;}};}
function socket(){return {readyState:1,paused:0,resumed:0,pause(){this.paused++;},resume(){this.resumed++;}};}
test("pauses upstream when downstream applies backpressure",()=>{
 const res=response(false),ws=socket();
 assert.equal(writeSseFrame(res,ws,"event: market\ndata: {}\n\n"),false);
 assert.equal(ws.paused,1);
});
test("does not pause upstream when downstream accepts data",()=>{
 const res=response(true),ws=socket();
 assert.equal(writeSseFrame(res,ws,"data: ok\n\n"),true);
 assert.equal(ws.paused,0);
});
test("resumes only an open upstream after downstream drain",()=>{
 const ws=socket();
 assert.equal(resumeUpstream(ws),true);
 assert.equal(ws.resumed,1);
 assert.equal(resumeUpstream(ws,true),false);
 assert.equal(resumeUpstream({...ws,readyState:3}),false);
});
test("ignores writes after response closure",()=>{
 const res=response(true),ws=socket();res.destroyed=true;
 assert.equal(writeSseFrame(res,ws,"data: x\n\n"),false);
 assert.equal(res.writes.length,0);
});
test("rejects oversized frames before buffering them",()=>{
 const res=response(true),ws=socket();
 assert.throws(()=>writeSseFrame(res,ws,"x".repeat(DEFAULT_MAX_FRAME_BYTES+1)),{status:413});
 assert.equal(res.writes.length,0);
});
