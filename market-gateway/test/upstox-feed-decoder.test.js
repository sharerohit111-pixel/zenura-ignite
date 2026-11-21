"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const protobuf=require("protobufjs");
const {decodeFeedResponse}=require("../lib/upstox-feed-decoder");
let FeedResponse;
test("loads the checked-in Upstox v3 protobuf schema",async()=>{
 const root=await protobuf.load(path.join(__dirname,"..","proto","MarketDataFeedV3.proto"));
 FeedResponse=root.lookupType("com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse");
 assert.ok(FeedResponse);
});
test("decodes a binary LTPC market update and preserves integer timestamps",async()=>{
 const root=await protobuf.load(path.join(__dirname,"..","proto","MarketDataFeedV3.proto"));
 const Type=root.lookupType("com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse");
 const payload=Type.encode(Type.create({
  type:1,currentTs:"1731931200123",
  feeds:{"NSE_EQ|INE001A01036":{ltpc:{ltp:245.65,ltt:"1731931200000",ltq:"12",cp:240.1}}}
 })).finish();
 const result=decodeFeedResponse(Type,Buffer.from(payload));
 assert.equal(result.type,"live_feed");
 assert.equal(result.currentTs,"1731931200123");
 assert.equal(result.feeds["NSE_EQ|INE001A01036"].ltpc.ltp,245.65);
 assert.equal(result.feeds["NSE_EQ|INE001A01036"].ltpc.ltt,"1731931200000");
 assert.equal(result.feeds["NSE_EQ|INE001A01036"].ltpc.ltq,"12");
});
test("decodes full market depth, option Greeks and OHLC fields",async()=>{
 const root=await protobuf.load(path.join(__dirname,"..","proto","MarketDataFeedV3.proto"));
 const Type=root.lookupType("com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse");
 const payload=Type.encode(Type.create({feeds:{"NSE_FO|TEST":{fullFeed:{marketFF:{
  ltpc:{ltp:101.5,ltt:"1731931200000"},
  marketLevel:{bidAskQuote:[{bidQ:"20",bidP:101.4,askQ:"15",askP:101.6}]},
  optionGreeks:{delta:0.52,theta:-0.03,gamma:0.01,vega:0.12,rho:0.02},
  marketOHLC:{ohlc:[{interval:"1d",open:99,high:103,low:98,close:101.5,vol:"5000",ts:"1731931200000"}]},
  oi:12000,iv:18.5
 }}}}})).finish();
 const result=decodeFeedResponse(Type,payload);
 const full=result.feeds["NSE_FO|TEST"].fullFeed.marketFF;
 assert.equal(full.marketLevel.bidAskQuote[0].bidQ,"20");
 assert.equal(full.optionGreeks.delta,0.52);
 assert.equal(full.marketOHLC.ohlc[0].vol,"5000");
 assert.equal(full.oi,12000);
 assert.equal(full.iv,18.5);
});
test("rejects invalid decoder types and non-binary payloads",()=>{
 assert.throws(()=>decodeFeedResponse(null,Buffer.from([])),TypeError);
 assert.throws(()=>decodeFeedResponse({decode(){},toObject(){}},{}),TypeError);
});
test("rejects malformed protobuf bytes",async()=>{
 const root=await protobuf.load(path.join(__dirname,"..","proto","MarketDataFeedV3.proto"));
 const Type=root.lookupType("com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse");
 assert.throws(()=>decodeFeedResponse(Type,Buffer.from([0xff,0xff,0xff])));
});

test("receives and decodes a binary feed frame over a local WebSocket server",async(t)=>{
 const WebSocket=require("ws");
 const root=await protobuf.load(path.join(__dirname,"..","proto","MarketDataFeedV3.proto"));
 const Type=root.lookupType("com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse");
 const expected={type:1,currentTs:"1731931200123",feeds:{"NSE_EQ|INE001A01036":{ltpc:{ltp:250.25,ltt:"1731931200000",ltq:"8",cp:249.5}}}};
 const frame=Type.encode(Type.create(expected)).finish();
 const server=new WebSocket.WebSocketServer({host:"127.0.0.1",port:0});
 await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
 const address=server.address();
 const received=new Promise((resolve,reject)=>{
  server.once("connection",socket=>socket.send(frame,{binary:true},error=>{if(error)reject(error);else resolve();}));
 });
 const client=new WebSocket("ws://127.0.0.1:"+address.port);
 const decoded=new Promise((resolve,reject)=>{
  client.once("message",(bytes,isBinary)=>{
   try{
    assert.equal(isBinary,true);
    resolve(decodeFeedResponse(Type,bytes));
   }catch(error){reject(error);}
  });
  client.once("error",reject);
 });
 t.after(async()=>{
  if(client.readyState===WebSocket.OPEN||client.readyState===WebSocket.CONNECTING)client.close();
  await new Promise(resolve=>server.close(resolve));
 });
 await received;
 const result=await decoded;
 assert.equal(result.feeds["NSE_EQ|INE001A01036"].ltpc.ltp,250.25);
 assert.equal(result.currentTs,"1731931200123");
});
