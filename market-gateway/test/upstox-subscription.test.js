"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const WebSocket=require("ws");
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
test("sends a valid subscription over a local WebSocket integration server",async(t)=>{
 const server=new WebSocket.WebSocketServer({host:"127.0.0.1",port:0});
 await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
 const address=server.address();
 const received=new Promise((resolve,reject)=>{
  server.once("connection",socket=>socket.once("message",bytes=>{
   try{resolve(JSON.parse(bytes.toString()));}catch(error){reject(error);}
  }));
 });
 const client=new WebSocket("ws://127.0.0.1:"+address.port);
 t.after(async()=>{
  if(client.readyState===WebSocket.OPEN||client.readyState===WebSocket.CONNECTING)client.close();
  await new Promise(resolve=>server.close(resolve));
 });
 await new Promise((resolve,reject)=>{client.once("open",resolve);client.once("error",reject);});
 await sendUpstoxSubscription(client,{mode:"ltpc",instrumentKeys:["NSE_INDEX|Nifty 50"],guid:"integration-guid"});
 assert.deepEqual(await received,{guid:"integration-guid",method:"sub",data:{mode:"ltpc",instrumentKeys:["NSE_INDEX|Nifty 50"]}});
});
