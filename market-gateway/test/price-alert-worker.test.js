"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {groupAlertsByUser,createPriceAlertWorker}=require("../lib/price-alert-worker");

const alerts=[
 {alert_id:"a",user_id:"u1",instrument_key:"NSE_EQ|A"},
 {alert_id:"b",user_id:"u1",instrument_key:"NSE_EQ|B"},
 {alert_id:"c",user_id:"u2",instrument_key:"NSE_EQ|A"}
];
test("groups only well-formed alerts by tenant",()=>{
 const groups=groupAlertsByUser([...alerts,{alert_id:"bad",instrument_key:"x"}]);
 assert.deepEqual([...groups.keys()],["u1","u2"]);
 assert.equal(groups.get("u1").length,2);
});
test("uses each user's own Upstox token, batches instruments and evaluates fresh quotes",async()=>{
 const calls={tokens:[],urls:[],evaluated:[]};
 const db={
  from(){return {select(){return this;},eq(){return this;},order(){return this;},limit:async()=>({data:alerts,error:null})};},
  async rpc(name,args){calls.evaluated.push({name,args});return {data:args.p_alert_id==="a",error:null};}
 };
 const worker=createPriceAlertWorker({
  serviceDb:db,
  async getUpstoxAccessToken(uid){calls.tokens.push(uid);return {token:"token-"+uid};},
  async fetchProvider(url,options){calls.urls.push({url,authorization:options.headers.Authorization});return {ok:true};},
  async readProviderJson(){return {data:{a:{instrument_token:"NSE_EQ|A",last_price:100,last_trade_time:Date.now()},b:{instrument_token:"NSE_EQ|B",last_price:200,last_trade_time:Date.now()}}};},
  normalizeProviderQuote(entry,key){return entry?{pricePaise:Math.round(entry.last_price*100),tradeTimeMs:entry.last_trade_time}:null;}
 });
 const result=await worker.run();
 assert.deepEqual(calls.tokens.sort(),["u1","u2"]);
 assert.equal(calls.evaluated.length,3);
 assert.equal(result.triggered,2);
 assert.equal(result.observed,3);
 assert.ok(calls.urls.every(c=>c.authorization.startsWith("Bearer token-")));
});
test("bounds worker batch configuration",async()=>{
 const worker=createPriceAlertWorker({serviceDb:{from(){return{};},rpc(){}},getUpstoxAccessToken(){},fetchProvider(){},readProviderJson(){},normalizeProviderQuote(){}});
 await assert.rejects(worker.run({maxAlerts:1001}),TypeError);
});
