"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Module=require("node:module");

process.env.NODE_ENV="test";
process.env.SUPABASE_URL="https://project.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY="sb_publishable_mock_market_test";
process.env.SUPABASE_SERVICE_ROLE_KEY="server-only-mock-market-test";

const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
  if(request==="@supabase/supabase-js")return {createClient(){
    return {
      auth:{async getUser(){return {data:{user:null},error:{message:"not used by public demo routes"}};}},
      async rpc(){return {data:null,error:null};},
      from(){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null,error:null})};}
    };
  }};
  return originalLoad.call(this,request,parent,isMain);
};
const {app}=require("../supabase-server");
Module._load=originalLoad;

let server,baseUrl;
test.before(async()=>{
  server=app.listen(0,"127.0.0.1");
  await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  baseUrl="http://127.0.0.1:"+server.address().port;
});
test.after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));});

test("GET /demo/instruments searches NSE/BSE synthetic equities without touching live master",async()=>{
  const response=await fetch(baseUrl+"/demo/instruments?kind=equities&exchange=BSE&q=tcs");
  const body=await response.json();
  assert.equal(response.status,200);assert.equal(body.source,"SYNTHETIC_MOCK_JSON");assert.equal(body.isLive,false);
  assert.equal(body.results.length,1);assert.equal(body.results[0].trading_symbol,"TCS");
  assert.equal(response.headers.get("cache-control"),"public, max-age=60");
});
test("GET /demo/expiries returns deterministic future expiries",async()=>{
  const response=await fetch(baseUrl+"/demo/expiries?underlying=NIFTY");
  const body=await response.json();
  assert.deepEqual(body.expiries,["2026-11-26","2026-12-31"]);assert.equal(body.isLive,false);
});
test("GET /demo/options-chain filters exact expiry and strike CE/PE",async()=>{
  const response=await fetch(baseUrl+"/demo/options-chain?underlying=NIFTY&expiry=2026-11-26&strike=25000");
  const body=await response.json();
  assert.equal(response.status,200);assert.equal(body.strikes.length,1);
  assert.equal(body.strikes[0].strike,25000);assert.equal(body.strikes[0].CE.instrument_type,"CE");
  assert.equal(body.strikes[0].PE.instrument_type,"PE");
});
test("GET /demo/quotes and /demo/candles are deterministic and visibly synthetic",async()=>{
  const instruments=await (await fetch(baseUrl+"/demo/instruments?kind=equities&exchange=NSE&limit=1")).json();
  const key=encodeURIComponent(instruments.results[0].instrument_key);
  const [quoteA,quoteB,candlesA,candlesB]=await Promise.all([
    fetch(baseUrl+"/demo/quotes?instrument_key="+key).then(x=>x.json()),
    fetch(baseUrl+"/demo/quotes?instrument_key="+key).then(x=>x.json()),
    fetch(baseUrl+"/demo/candles?instrument_key="+key+"&timeframe=5m&count=10").then(x=>x.json()),
    fetch(baseUrl+"/demo/candles?instrument_key="+key+"&timeframe=5m&count=10").then(x=>x.json())
  ]);
  assert.deepEqual(quoteA,quoteB);assert.equal(quoteA.source,"SYNTHETIC_MOCK_JSON");assert.equal(quoteA.isLive,false);
  assert.equal(quoteA.bids.length,5);assert.equal(quoteA.asks.length,5);assert.deepEqual(candlesA,candlesB);
  assert.equal(candlesA.candles.length,10);assert.equal(candlesA.label,"DEMO DATA · SYNTHETIC ONLY");
});
test("demo endpoints reject invalid filters and unknown instruments",async()=>{
  const badFilter=await fetch(baseUrl+"/demo/instruments?exchange=MCX");
  const badQuote=await fetch(baseUrl+"/demo/quotes?instrument_key=UNKNOWN");
  assert.equal(badFilter.status,400);assert.equal(badQuote.status,404);
});
