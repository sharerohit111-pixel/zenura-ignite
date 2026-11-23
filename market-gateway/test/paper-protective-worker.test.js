"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createPaperProtectiveWorker}=require("../lib/paper-protective-worker");

const baseOrder={
 order_id:"d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1",
 user_id:"11111111-1111-4111-8111-111111111111",
 asset_class:"EQUITY",instrument_key:"NSE_EQ|TEST",product:"DELIVERY",
 side:"SELL",trigger_type:"STOP_LOSS",trigger_direction:"AT_OR_BELOW",
 trigger_price_paise:9000,quantity:2,status:"ACTIVE",created_at:"2026-11-22T00:00:00Z"
};
const instrument={instrument_key:"NSE_EQ|TEST",instrument_type:"EQ",segment:"NSE_EQ"};
const position={instrument_key:"NSE_EQ|TEST",product:"DELIVERY",quantity:10,reserved_quantity:2};

function harness({orders=[baseOrder],positions=[position],quoteError=false,tokenError=false,fillResult={data:{status:"FILLED"}},lease=true,instruments=[instrument]}={}){
 const calls=[],updates=[];
 const db={
  async rpc(name,args){
   calls.push({type:"rpc",name,args});
   if(name==="acquire_paper_market_worker_lease")return {data:lease};
   if(name==="release_paper_market_worker_lease")return {data:true};
   if(name==="execute_paper_equity_protective_fill")return fillResult;
   throw new Error("Unexpected RPC "+name);
  },
  from(table){
   const q={table,action:"select",filters:[],values:null,select(){return this;},
    update(values){this.action="update";this.values=values;return this;},
    eq(key,value){this.filters.push(["eq",key,value]);return this;},
    in(key,value){this.filters.push(["in",key,value]);return this;},
    order(){return this;},
    limit(){return Promise.resolve(this.result());},
    result(){
      if(this.action==="update"){updates.push({table:this.table,filters:this.filters,values:this.values});return {data:null,error:null};}
      return {data:this.table==="paper_protective_orders"?orders:this.table==="paper_equity_positions"?positions:[],error:null};
    },
    then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject);}
   };
   return q;
  }
 };
 const worker=createPaperProtectiveWorker({
  serviceDb:db,
  ensureInstrumentCache:async()=>instruments,
  getUpstoxAccessToken:async()=>{if(tokenError)throw Object.assign(new Error("expired"),{status:403});return {token:"fixture-token"};},
  fetchProvider:async()=>({ok:true}),
  readProviderJson:async()=>({data:{quote:{instrument_token:"NSE_EQ|TEST",last_price:85,cp:90,ltp:85,ts:Date.now()}}}),
  normalizeProviderQuote:(_entry,key,options)=>{
   if(quoteError)throw new Error("stale quote");
   return {instrumentKey:key,pricePaise:8500,tradeTimeMs:options.now};
  }
 });
 return {worker,calls,updates};
}

test("protective worker leases, fetches the exact user quote and executes one simulated equity fill",async()=>{
 const h=harness();
 const result=await h.worker({maxOrders:10});
 assert.deepEqual(result,{locked:false,scanned:1,filled:1,notEligible:0,failed:0});
 const lease=h.calls.find(x=>x.name==="acquire_paper_market_worker_lease");
 assert.equal(lease.args.p_state_key,"paper_protective_orders");
 assert.equal(lease.args.p_ttl_ms,240000);
 const fill=h.calls.find(x=>x.name==="execute_paper_equity_protective_fill");
 assert.ok(fill);
 assert.equal(fill.args.p_protective_order_id,baseOrder.order_id);
 assert.equal(fill.args.p_execution_price_paise,8500);
 assert.ok(fill.args.p_now_ms>=fill.args.p_quote_timestamp_ms);
 assert.ok(fill.args.p_now_ms-fill.args.p_quote_timestamp_ms<2000);
 assert.equal(fill.args.p_execution_order_id.length,64);
 assert.equal(fill.args.p_request_fingerprint.length,64);
 assert.ok(h.calls.some(x=>x.name==="release_paper_market_worker_lease"));
});

test("protective worker marks stale quotes checked and never calls the fill RPC",async()=>{
 const h=harness({quoteError:true});
 const result=await h.worker();
 assert.equal(result.notEligible,1);
 assert.equal(result.filled,0);
 assert.equal(h.calls.some(x=>x.name==="execute_paper_equity_protective_fill"),false);
 assert.equal(h.updates.length,1);
 assert.equal(h.updates[0].values.worker_checked_at!==undefined,true);
});

test("protective worker rotates unsupported instrument rows instead of starving the scan",async()=>{
 const h=harness({instruments:[]});
 const result=await h.worker();
 assert.equal(result.notEligible,1);
 assert.equal(result.filled,0);
 assert.equal(h.updates.length,1);
 assert.equal(h.updates[0].values.worker_checked_at!==undefined,true);
});

test("protective worker rotates a user batch after an expired Upstox token",async()=>{
 const h=harness({tokenError:true});
 const result=await h.worker();
 assert.equal(result.failed,1);
 assert.equal(result.filled,0);
 assert.equal(h.updates.length,1);
 assert.ok(h.calls.some(x=>x.name==="release_paper_market_worker_lease"));
});

test("protective worker skips a busy lease without scanning orders",async()=>{
 const h=harness({lease:false});
 const result=await h.worker();
 assert.deepEqual(result,{locked:true,scanned:0,filled:0,notEligible:0,failed:0});
 assert.equal(h.calls.some(x=>x.name==="release_paper_market_worker_lease"),false);
});

test("protective worker treats cancellation/fill race rejection as not eligible, not a worker crash",async()=>{
 const h=harness({fillResult:{error:{code:"23514"}}});
 const result=await h.worker();
 assert.equal(result.notEligible,1);
 assert.equal(result.failed,0);
});
