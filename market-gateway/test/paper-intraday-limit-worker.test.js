"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createPaperIntradayLimitWorker}=require("../lib/paper-intraday-limit-worker");
const {marketDateString}=require("../lib/exchange-session-calendar");
const cooldown=require("../lib/upstox-user-cooldown");
test.beforeEach(()=>cooldown.clearAllUpstoxUserCooldownsForTests());

function makeDb({orders=[],locked=false,failExpiry=false}={}){
  const calls=[];
  const serviceDb={
    async rpc(name,args){
      calls.push({type:"rpc",name,args});
      if(name==="acquire_paper_market_worker_lease")return {data:!locked,error:null};
      if(name==="expire_paper_intraday_limit_orders")return {data:0,error:failExpiry?{code:"XX"}:null};
      if(name==="release_paper_market_worker_lease")return {data:true,error:null};
      if(name==="execute_paper_intraday_limit_fill")return {data:{status:"FILLED"},error:null};
      throw new Error("Unexpected RPC "+name);
    },
    from(table){
      const state={table,updated:false};
      const query={
        select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},
        or(){return this;},maybeSingle(){return Promise.resolve({data:null,error:null});},
        update(){state.updated=true;return this;},
        then(resolve,reject){
          const data=state.updated?null:(table==="paper_orders"?orders:[]);
          return Promise.resolve({data,error:null}).then(resolve,reject);
        }
      };
      return query;
    }
  };
  return {serviceDb,calls};
}
const instrument={instrument_key:"NSE_EQ|TEST",instrument_type:"EQ",segment:"NSE_EQ",exchange:"NSE"};
function deps(db,overrides={}){
  return {
    serviceDb:db,ensureInstrumentCache:async()=>[instrument],
    getUpstoxAccessToken:async()=>({token:"token"}),
    fetchProvider:async()=>({ok:true}),
    readProviderJson:async()=>({data:{quote:{instrument_token:instrument.instrument_key}}}),
    normalizeProviderQuote:()=>({pricePaise:9900,tradeTimeMs:Date.now()-1000,quoteAgeMs:1000}),
    loadSession:async()=>({exchange:"NSE",sessionDate:marketDateString(Date.now()),
      isTradingDay:true,openMinute:0,closeMinute:1440}),
    ...overrides
  };
}
function pendingOrder(){
  const now=Date.now();
  return {order_id:"a".repeat(64),user_id:"11111111-1111-4111-8111-111111111111",
    instrument_key:instrument.instrument_key,trading_symbol:"TEST",exchange:"NSE",
    side:"BUY",product:"INTRADAY",order_type:"LIMIT",status:"PENDING",quantity:1,
    limit_price_paise:10000,simulation_only:true,created_at:new Date(now-60000).toISOString()};
}

test("a competing worker lease exits without scanning or releasing another worker lease",async()=>{
  const db=makeDb({locked:true});
  const run=createPaperIntradayLimitWorker(deps(db.serviceDb));
  const result=await run();
  assert.equal(result.locked,true);
  assert.equal(db.calls.filter(x=>x.name==="release_paper_market_worker_lease").length,0);
  assert.equal(db.calls.filter(x=>x.name==="expire_paper_intraday_limit_orders").length,0);
});

test("missing verified session never attempts an Intraday LIMIT fill",async()=>{
  const db=makeDb({orders:[pendingOrder()]});
  const run=createPaperIntradayLimitWorker(deps(db.serviceDb,{loadSession:async()=>null}));
  const result=await run();
  assert.equal(result.scanned,1);
  assert.equal(result.filled,0);
  assert.equal(result.notEligible,1);
  assert.equal(db.calls.some(x=>x.name==="execute_paper_intraday_limit_fill"),false);
  assert.equal(db.calls.some(x=>x.name==="expire_paper_intraday_limit_orders"),true);
});

test("fresh threshold-crossed NSE quote uses the atomic Intraday fill RPC",async()=>{
  const db=makeDb({orders:[pendingOrder()]});
  const run=createPaperIntradayLimitWorker(deps(db.serviceDb));
  const result=await run();
  assert.equal(result.scanned,1);
  assert.equal(result.filled,1);
  const fill=db.calls.find(x=>x.name==="execute_paper_intraday_limit_fill");
  assert.ok(fill);
  assert.equal(fill.args.p_order_id,"a".repeat(64));
  assert.equal(fill.args.p_execution_price_paise,9900);
  assert.equal(db.calls.some(x=>x.name==="release_paper_market_worker_lease"),true);
});

test("fresh BSE quote uses the BSE-verified session and atomic Intraday LIMIT fill RPC",async()=>{
  const bseInstrument={instrument_key:"BSE_EQ|INE002A01018",instrument_type:"EQ",segment:"BSE_EQ",exchange:"BSE"};
  const bseOrder={...pendingOrder(),order_id:"b".repeat(64),instrument_key:bseInstrument.instrument_key,
    trading_symbol:"RELIANCE",exchange:"BSE"};
  const db=makeDb({orders:[bseOrder]});
  const run=createPaperIntradayLimitWorker(deps(db.serviceDb,{
    ensureInstrumentCache:async()=>[bseInstrument],
    readProviderJson:async()=>({data:{quote:{instrument_token:bseInstrument.instrument_key}}}),
    normalizeProviderQuote:()=>({pricePaise:9900,tradeTimeMs:Date.now()-1000,quoteAgeMs:1000}),
    loadSession:async(_serviceDb,exchange)=>({exchange,sessionDate:marketDateString(Date.now()),
      isTradingDay:true,openMinute:0,closeMinute:1440})
  }));
  const result=await run();
  assert.equal(result.scanned,1);
  assert.equal(result.filled,1);
  const fill=db.calls.find(x=>x.name==="execute_paper_intraday_limit_fill");
  assert.ok(fill);
  assert.equal(fill.args.p_order_id,"b".repeat(64));
});
test("expiry failure aborts before instrument, quote or order processing",async()=>{
  const db=makeDb({orders:[pendingOrder()],failExpiry:true});
  let cacheLoads=0;
  const run=createPaperIntradayLimitWorker(deps(db.serviceDb,{ensureInstrumentCache:async()=>{cacheLoads++;return [instrument];}}));
  await assert.rejects(run(),/session expiry/);
  assert.equal(cacheLoads,0);
  assert.equal(db.calls.some(x=>x.name==="release_paper_market_worker_lease"),true);
});


test("provider 429 cools down the user across later worker cycles",async()=>{
  const db=makeDb({orders:[pendingOrder()]});
  let providerCalls=0;
  const d=deps(db.serviceDb,{
    fetchProvider:async()=>{
      providerCalls++;
      return {ok:false,status:429,headers:{get:name=>name==="retry-after"?"30":null}};
    }
  });
  const run=createPaperIntradayLimitWorker(d);
  const first=await run();
  assert.equal(first.failed,1);
  assert.equal(providerCalls,1);
  assert.equal(cooldown.getUpstoxUserCooldown(pendingOrder().user_id).kind,"rate_limit");
  const second=await run();
  assert.equal(second.failed,1);
  assert.equal(providerCalls,1);
});
