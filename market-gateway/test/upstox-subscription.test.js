"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createUpstoxSubscription,sendUpstoxSubscription}=require("../lib/upstox-subscription");
test("builds the documented subscription envelope with a stable instrument list",()=>{
 const frame=createUpstoxSubscription({mode:"full",instrumentKeys:["NSE_EQ|INE001A01036"],guid:"test-guid"});
 assert.deepEqual(frame,{guid:"test-guid",method:"sub",data:{mode:"full",instrumentKeys:["NSE_EQ|INE001A01036"]}});
});
test("rejects unsupported modes, empty keys, duplicates and missing GUIDs",()=>{
 assert.throws(()=>createUpstoxSubscription({mode:"unknown",instrumentKeys:["A"]}),TypeError);
 assert.throws(()=>createUpstoxSubscription({mode:"ltpc",instrumentKeys:[]}),TypeError);
 assert.throws(()=>createUpstoxSubscription({mode:"ltpc",instrumentKeys:["A","A"]}),TypeError);
 assert.throws(()=>createUpstoxSubscription({mode:"ltpc",instrumentKeys:["A"],guid:" "}),TypeError);
});
test("does not send until the WebSocket is open",async()=>{
 await assert.rejects(sendUpstoxSubscription({readyState:0,send(){}},{mode:"ltpc",instrumentKeys:["A"]}),/not open/);
});
test("sends the subscription envelope through an open WebSocket adapter",async()=>{
 let sent=null;
 const socket={readyState:1,send(payload,callback){sent=payload;callback(null);}};
 const payload=await sendUpstoxSubscription(socket,{mode:"ltpc",instrumentKeys:["NSE_INDEX|Nifty 50"],guid:"integration-guid"});
 assert.equal(payload,sent);
 assert.deepEqual(JSON.parse(sent.toString()),{guid:"integration-guid",method:"sub",data:{mode:"ltpc",instrumentKeys:["NSE_INDEX|Nifty 50"]}});
});
test("propagates WebSocket send errors",async()=>{
 const failure=new Error("socket send failed");
 await assert.rejects(sendUpstoxSubscription({readyState:1,send(payload,callback){callback(failure);}},{mode:"ltpc",instrumentKeys:["A"]}),failure);
});
