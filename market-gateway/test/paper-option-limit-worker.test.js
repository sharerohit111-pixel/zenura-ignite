"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {
 createPaperOptionLimitWorker,isContractExpired,isValidNseOptionLimitOrder,optionSessionState
}=require("../lib/paper-option-limit-worker");

const NOW=Date.parse("2026-11-23T05:00:00.000Z");
const USER="edededed-eded-4ded-8ded-edededededed";
const ORDER="a".repeat(64);
const KEY="NSE_FO|NIFTY26NOV25000CE";
const order={
 order_id:ORDER,user_id:USER,instrument_key:KEY,trading_symbol:"NIFTY26NOV25000CE",
 exchange:"NSE",segment:"NSE_FO",instrument_type:"CE",expiry:"2026-11-26",
 strike_price:25000,lot_size:65,tick_size_paise:5,side:"BUY",
 quantity:65,filled_quantity:0,remaining_quantity:65,limit_price_paise:1250,
 reserved_cash_paise:83646,reserved_close_quantity:0,status:"PENDING",
 expires_at:"2026-11-23T06:00:00.000Z",simulation_only:true,
 created_at:"2026-11-23T04:00:00.000Z"
};
const instrument={
 instrument_key:KEY,trading_symbol:"NIFTY26NOV25000CE",exchange:"NSE",
 segment:"NSE_FO",instrument_type:"CE",expiry:"2026-11-26",
 strike_price:25000,lot_size:65,tick_size:5
};
function makeDb({orders=[order],fills=[],lease=true,onRpc}={}){
 const calls=[];
 const db={
  calls,
  async rpc(name,args){
   calls.push({type:"rpc",name,args});
   if(name==="acquire_paper_market_worker_lease")return {data:lease,error:null};
   if(name==="release_paper_market_worker_lease")return {data:true,error:null};
   if(onRpc)return onRpc(name,args);
   if(name==="execute_paper_option_limit_fill")return {data:{status:"PARTIALLY_FILLED"},error:null};
   return {data:{status:"EXPIRED",idempotent_replay:false},error:null};
  },
  from(table){
   const state={table,operation:"select",filters:[],payload:null};
   const builder={
    select(columns){state.columns=columns;return builder;},
    eq(key,value){state.filters.push([key,value]);return builder;},
    in(key,value){state.filters.push([key,value]);return builder;},
    order(){return builder;},
    limit(){return builder;},
    or(){return builder;},
    update(value){state.operation="update";state.payload=value;return builder;},
    maybeSingle(){return Promise.resolve({data:null,error:null});},
    then(resolve,reject){
     const data=table==="paper_option_limit_orders"?orders:table==="paper_option_limit_fills"?fills:[];
     return Promise.resolve({data,error:null}).then(resolve,reject);
    }
   };
   calls.push({type:"query",table,state});
   return builder;
  }
 };
 return db;
}
function quotePayload(){
 return {status:"success",data:{[KEY]:{
  instrument_token:KEY,timestamp:new Date(NOW-1000).toISOString(),
  depth:{buy:[{price:12.35,quantity:20}],sell:[{price:12.4,quantity:10}]}
 }}};
}
function deps(db,{session=true,payload=quotePayload(),token=true,now=()=>NOW}={}){
 return {
  serviceDb:db,ensureInstrumentCache:async()=>[instrument],
  getUpstoxAccessToken:async()=>token?{token:"token-"+USER}:Promise.reject(new Error("no token")),
  fetchProvider:async()=>({ok:true}),readProviderJson:async()=>payload,
  loadSession:async()=>session?{
   exchange:"NSE",sessionDate:"2026-11-23",isTradingDay:true,
   openMinute:555,closeMinute:930
  }:null,
  now
 };
}

test("validates only exact NSE CE/PE contracts and reserved side invariants",()=>{
 assert.equal(isValidNseOptionLimitOrder(order,instrument),true);
 assert.equal(isValidNseOptionLimitOrder({...order,exchange:"BSE"},instrument),false);
 assert.equal(isValidNseOptionLimitOrder(order,{...instrument,instrument_type:"PE"}),false);
 assert.equal(isValidNseOptionLimitOrder(order,{...instrument,lot_size:25}),false);
 assert.equal(isValidNseOptionLimitOrder(order,{...instrument,tick_size:0.01}),false);
 assert.equal(isValidNseOptionLimitOrder({...order,reserved_cash_paise:0},instrument),false);
 const sell={...order,side:"SELL",reserved_cash_paise:0,reserved_close_quantity:65};
 assert.equal(isValidNseOptionLimitOrder(sell,instrument),true);
 assert.equal(isValidNseOptionLimitOrder({...sell,reserved_close_quantity:10},instrument),false);
});

test("treats invalid and reached option expiry cutoffs as expired",()=>{
 assert.equal(isContractExpired({...order,expiry:"bad"},NOW),true);
 assert.equal(isContractExpired(order,NOW),false);
 assert.equal(isContractExpired({...order,expiry:"2026-11-23"},Date.parse("2026-11-23T16:00:00+05:30")),true);
});

test("distinguishes before-open, open, closed and missing verified NSE sessions",()=>{
 const before=Date.parse("2026-11-23T03:00:00.000Z");
 const open=Date.parse("2026-11-23T05:00:00.000Z");
 const closed=Date.parse("2026-11-23T11:00:00.000Z");
 const session={exchange:"NSE",sessionDate:"2026-11-23",isTradingDay:true,openMinute:555,closeMinute:930};
 assert.equal(optionSessionState(before,session),"BEFORE_OPEN");
 assert.equal(optionSessionState(open,session),"OPEN");
 assert.equal(optionSessionState(closed,session),"CLOSED");
 assert.equal(optionSessionState(open,null),"MISSING");
});

test("fills from executable ask, bounds by displayed depth and passes exact quote snapshot to SQL",async()=>{
 const db=makeDb();
 const result=await createPaperOptionLimitWorker(deps(db))({maxOrders:10});
 assert.equal(result.scanned,1);
 assert.equal(result.partial,1);
 assert.equal(result.failed,0);
 const call=db.calls.find(x=>x.type==="rpc"&&x.name==="execute_paper_option_limit_fill");
 assert.ok(call);
 assert.equal(call.args.p_fill_quantity,10);
 assert.equal(call.args.p_execution_price_paise,1240);
 assert.equal(call.args.p_bid_price_paise,1235);
 assert.equal(call.args.p_ask_price_paise,1240);
 assert.equal(call.args.p_bid_quantity,20);
 assert.equal(call.args.p_ask_quantity,10);
 assert.equal(call.args.p_quote_timestamp_ms,NOW-1000);
 assert.equal(call.args.p_now_ms,NOW);
 assert.match(call.args.p_execution_id,/^[a-f0-9]{64}$/);
 assert.ok(db.calls.some(x=>x.type==="rpc"&&x.name==="release_paper_market_worker_lease"));
});

test("fails closed and preserves pending orders when verified session data is missing",async()=>{
 let expireCalls=0,tokenRequested=false;
 const db=makeDb({onRpc:async(name)=>{
  if(name==="expire_paper_option_limit_order")expireCalls++;
  return {data:true,error:null};
 }});
 const d=deps(db,{session:false,token:false});
 d.getUpstoxAccessToken=async()=>{tokenRequested=true;throw new Error("must not request token");};
 const result=await createPaperOptionLimitWorker(d)({maxOrders:10});
 assert.equal(result.expired,0);
 assert.equal(result.notEligible,1);
 assert.equal(expireCalls,0);
 assert.equal(tokenRequested,false);
});

test("keeps valid day orders pending before the verified session opens",async()=>{
 let expireCalls=0,tokenCalls=0;
 const db=makeDb({onRpc:async(name)=>{
  if(name==="expire_paper_option_limit_order")expireCalls++;
  return {data:true,error:null};
 }});
 const beforeOpen=Date.parse("2026-11-23T03:00:00.000Z");
 const d=deps(db,{now:()=>beforeOpen});
 d.getUpstoxAccessToken=async()=>{tokenCalls++;return {token:"unused"};};
 const result=await createPaperOptionLimitWorker(d)({maxOrders:10});
 assert.equal(result.expired,0);
 assert.equal(result.notEligible,1);
 assert.equal(expireCalls,0);
 assert.equal(tokenCalls,0);
});

test("does not fill from missing, stale or off-tick executable depth",async()=>{
 const payload=quotePayload();
 payload.data[KEY].depth.sell[0].price=12.41;
 let fillCalls=0;
 const db=makeDb({onRpc:async(name)=>{
  if(name==="execute_paper_option_limit_fill")fillCalls++;
  return {data:true,error:null};
 }});
 const result=await createPaperOptionLimitWorker(deps(db,{payload}))({maxOrders:10});
 assert.equal(fillCalls,0);
 assert.equal(result.notEligible,1);
});

test("does not scan orders or release a lease owned by another worker",async()=>{
 const db=makeDb({lease:false});
 const result=await createPaperOptionLimitWorker(deps(db))({maxOrders:10});
 assert.deepEqual(result,{locked:true,scanned:0,filled:0,partial:0,notEligible:0,failed:0,expired:0});
 assert.equal(db.calls.some(call=>call.type==="query"),false);
 assert.equal(db.calls.some(call=>call.type==="rpc"&&call.name==="release_paper_market_worker_lease"),false);
});

test("rejects invalid batch sizes before acquiring a lease",async()=>{
 const db=makeDb();
 const worker=createPaperOptionLimitWorker(deps(db));
 await assert.rejects(()=>worker({maxOrders:0}),/batch size is invalid/);
 await assert.rejects(()=>worker({maxOrders:101}),/batch size is invalid/);
 assert.equal(db.calls.some(call=>call.type==="rpc"&&call.name==="acquire_paper_market_worker_lease"),false);
});

test("uses a separate connected Upstox token for each Options LIMIT account",async()=>{
 const secondUser="abababab-abab-4bab-8bab-abababababab";
 const secondOrder={...order,order_id:"b".repeat(64),user_id:secondUser};
 const db=makeDb({orders:[order,secondOrder]});
 const requestedUsers=[],authorizationHeaders=[];
 const d=deps(db);
 d.getUpstoxAccessToken=async userId=>{requestedUsers.push(userId);return {token:"token-for-"+userId};};
 d.fetchProvider=async(_url,options)=>{authorizationHeaders.push(options.headers.Authorization);return {ok:true};};
 const result=await createPaperOptionLimitWorker(d)({maxOrders:10});
 assert.equal(result.scanned,2);
 assert.equal(result.partial,2);
 assert.deepEqual(new Set(requestedUsers),new Set([USER,secondUser]));
 assert.deepEqual(new Set(authorizationHeaders),new Set(["Bearer token-for-"+USER,"Bearer token-for-"+secondUser]));
});
