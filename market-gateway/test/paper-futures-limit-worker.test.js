"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {
  createPaperFuturesLimitWorker,isContractExpired,isValidNseFuture,cumulativeFillCharges,isVerifiedSessionOpen
}=require("../lib/paper-futures-limit-worker");

const NOW=Date.parse("2026-11-23T05:00:00.000Z");
const USER="efefefef-efef-4fef-8fef-efefefefefef";
const ORDER="a".repeat(64);
const KEY="NSE_FO|NIFTY26NOVFUT";
const order={
  order_id:ORDER,user_id:USER,instrument_key:KEY,trading_symbol:"NIFTY26NOVFUT",
  exchange:"NSE",segment:"NSE_FO",side:"BUY",product:"DELIVERY",
  order_type:"LIMIT",status:"PENDING",quantity:25,filled_quantity:0,
  remaining_quantity:25,limit_price_paise:10000,tick_size_paise:5,
  lot_size:25,expiry:"2026-11-26",expires_at:"2026-11-23T06:00:00.000Z",
  reserved_open_margin_paise:200000,reserved_close_quantity:0,
  simulation_only:true,created_at:"2026-11-23T04:00:00.000Z"
};
const instrument={
  instrument_key:KEY,trading_symbol:"NIFTY26NOVFUT",exchange:"NSE",
  segment:"NSE_FO",instrument_type:"FUT",expiry:"2026-11-26",
  lot_size:25,tick_size:5
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
      return {data:{status:"PARTIALLY_FILLED"},error:null};
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
          let data=[];
          if(table==="paper_futures_orders")data=orders;
          if(table==="paper_futures_fills")data=fills;
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
  return {
    status:"success",
    data:{
      "NSE_FO:NIFTY26NOVFUT":{
        instrument_token:KEY,timestamp:new Date(NOW-1000).toISOString(),
        depth:{
          buy:[{price:98.95,quantity:8,orders:2}],
          sell:[{price:99,quantity:10,orders:3}]
        }
      }
    }
  };
}
function deps(db,{session=true,payload=quotePayload(),token=true}={}){
  return {
    serviceDb:db,ensureInstrumentCache:async()=>[instrument],
    getUpstoxAccessToken:async()=>token?{token:"test-token"}:Promise.reject(new Error("no token")),
    fetchProvider:async()=>({ok:true}),
    readProviderJson:async()=>payload,
    loadSession:async()=>session?{
      exchange:"NSE",sessionDate:"2026-11-23",isTradingDay:true,
      openMinute:555,closeMinute:930
    }:null,
    now:()=>NOW
  };
}

test("validates only exact NSE futures contract master matches",()=>{
  assert.equal(isValidNseFuture(order,instrument),true);
  assert.equal(isValidNseFuture({...order,exchange:"BSE"},instrument),false);
  assert.equal(isValidNseFuture(order,{...instrument,lot_size:50}),false);
  assert.equal(isValidNseFuture(order,{...instrument,tick_size:0.01}),false);
  assert.equal(isValidNseFuture(order,{...instrument,instrument_type:"CE"}),false);
});

test("honors verified special weekend sessions without weekday inference",()=>{
  const saturday=Date.parse("2026-11-28T05:00:00.000Z");
  const session={exchange:"NSE",sessionDate:"2026-11-28",isTradingDay:true,openMinute:555,closeMinute:930};
  assert.equal(isVerifiedSessionOpen(saturday,session),true);
  assert.equal(isVerifiedSessionOpen(saturday,{...session,closeMinute:600}),false);
  assert.equal(isVerifiedSessionOpen(saturday,{...session,sessionDate:"2026-11-27"}),false);
});

test("treats invalid and reached contract expiry cutoffs as expired",()=>{
  assert.equal(isContractExpired({...order,expiry:"bad"},NOW),true);
  assert.equal(isContractExpired(order,NOW),false);
  assert.equal(isContractExpired({...order,expiry:"2026-11-23"},Date.parse("2026-11-23T16:00:00+05:30")),true);
});

test("calculates incremental cumulative charges without repeating the brokerage cap",()=>{
  const first=cumulativeFillCharges({fills:[],grossPaise:100000,exchange:"NSE",side:"BUY"});
  const second=cumulativeFillCharges({
    fills:[{gross_paise:100000,charges_paise:first}],grossPaise:100000,
    exchange:"NSE",side:"BUY"
  });
  const total=cumulativeFillCharges({
    fills:[],grossPaise:200000,exchange:"NSE",side:"BUY"
  });
  assert.equal(first+second,total);
  assert.ok(second>=0);
});

test("fills only the displayed best ask quantity using a fresh V3 snapshot",async()=>{
  let fillArgs=null;
  const db=makeDb({onRpc:async(name,args)=>{
    if(name==="execute_paper_futures_limit_fill"){fillArgs=args;return {data:{status:"PARTIALLY_FILLED"},error:null};}
    return {data:true,error:null};
  }});
  const worker=createPaperFuturesLimitWorker(deps(db));
  const result=await worker({maxOrders:10});
  assert.equal(result.scanned,1);
  assert.equal(result.partial,1);
  assert.equal(result.failed,0);
  assert.equal(fillArgs.p_fill_quantity,10);
  assert.equal(fillArgs.p_execution_price_paise,9900);
  assert.equal(fillArgs.p_bid_price_paise,9895);
  assert.equal(fillArgs.p_ask_price_paise,9900);
  assert.equal(fillArgs.p_bid_quantity,8);
  assert.equal(fillArgs.p_ask_quantity,10);
  assert.equal(fillArgs.p_quote_timestamp_ms,NOW-1000);
  assert.equal(fillArgs.p_now_ms,NOW);
  assert.match(fillArgs.p_execution_id,/^[a-f0-9]{64}$/);
  assert.ok(fillArgs.p_charges_paise>0);
  assert.ok(db.calls.some(x=>x.type==="rpc"&&x.name==="release_paper_market_worker_lease"));
});

test("expires pending Futures LIMIT orders when the verified session is missing",async()=>{
  let expiredId=null,tokenRequested=false;
  const db=makeDb({onRpc:async(name,args)=>{
    if(name==="expire_paper_futures_limit_order"){expiredId=args.p_order_id;return {data:{status:"EXPIRED",idempotent_replay:false},error:null};}
    return {data:true,error:null};
  }});
  const d=deps(db,{session:false,token:false});
  d.getUpstoxAccessToken=async()=>{tokenRequested=true;throw new Error("must not request token");};
  const result=await createPaperFuturesLimitWorker(d)({maxOrders:10});
  assert.equal(result.expired,1);
  assert.equal(expiredId,ORDER);
  assert.equal(tokenRequested,false);
});

test("does not submit a fill from a crossed or missing executable book",async()=>{
  const payload=quotePayload();
  payload.data["NSE_FO:NIFTY26NOVFUT"].depth.sell[0].price=98.9;
  let fillCalls=0;
  const db=makeDb({onRpc:async(name,args)=>{
    if(name==="execute_paper_futures_limit_fill")fillCalls++;
    return {data:true,error:null};
  }});
  const result=await createPaperFuturesLimitWorker(deps(db,{payload}))({maxOrders:10});
  assert.equal(fillCalls,0);
  assert.equal(result.notEligible,1);
});

test("does not scan orders or release a Futures LIMIT lease owned by another worker",async()=>{
  const db=makeDb({lease:false});
  const result=await createPaperFuturesLimitWorker(deps(db))({maxOrders:10});
  assert.deepEqual(result,{
    locked:true,scanned:0,filled:0,partial:0,notEligible:0,failed:0,expired:0
  });
  assert.equal(db.calls.some(call=>call.type==="query"),false);
  assert.equal(db.calls.some(call=>call.type==="rpc"&&call.name==="release_paper_market_worker_lease"),false);
});

test("rejects invalid Futures LIMIT worker batch sizes before acquiring a lease",async()=>{
  const db=makeDb();
  const worker=createPaperFuturesLimitWorker(deps(db));
  await assert.rejects(()=>worker({maxOrders:0}),/batch size is invalid/);
  await assert.rejects(()=>worker({maxOrders:101}),/batch size is invalid/);
  assert.equal(db.calls.some(call=>call.type==="rpc"&&call.name==="acquire_paper_market_worker_lease"),false);
});

test("uses a separate connected Upstox token for each Futures LIMIT account",async()=>{
  const secondUser="abababab-abab-4bab-8bab-abababababab";
  const secondOrder={...order,order_id:"b".repeat(64),user_id:secondUser};
  const db=makeDb({orders:[order,secondOrder]});
  const requestedUsers=[],authorizationHeaders=[];
  const d=deps(db);
  d.getUpstoxAccessToken=async userId=>{
    requestedUsers.push(userId);
    return {token:"token-for-"+userId};
  };
  d.fetchProvider=async(_url,options)=>{
    authorizationHeaders.push(options.headers.Authorization);
    return {ok:true};
  };
  const result=await createPaperFuturesLimitWorker(d)({maxOrders:10});
  assert.equal(result.scanned,2);
  assert.equal(result.partial,2);
  assert.deepEqual(new Set(requestedUsers),new Set([USER,secondUser]));
  assert.deepEqual(new Set(authorizationHeaders),new Set([
    "Bearer token-for-"+USER,"Bearer token-for-"+secondUser
  ]));
});
