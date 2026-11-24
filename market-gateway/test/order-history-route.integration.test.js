"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Module=require("node:module");

const uid="11111111-2222-4333-8444-555555555555";
const token="order-history-route-test-token";
const queryCalls=[];
let rows=[];
const originalLoad=Module._load;

process.env.NODE_ENV="test";
process.env.SUPABASE_URL="https://project.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY="sb_publishable_order_history_test";
process.env.SUPABASE_SERVICE_ROLE_KEY="server-only-order-history-test";

Module._load=function(request,parent,isMain){
  if(request==="@supabase/supabase-js"){
    return {createClient(_url,key){
      return {
        auth:{async getUser(candidate){return candidate===token
          ?{data:{user:{id:uid,email:"history@example.test"}},error:null}
          :{data:{user:null},error:{message:"invalid token"}};}},
        async rpc(){return {data:{},error:null};},
        from(table){
          const query={table,filters:[],orders:[],requestedLimit:null};
          query.select=function(columns){this.columns=columns;return this;};
          query.eq=function(column,value){this.filters.push([column,value]);return this;};
          query.or=function(expression){this.orExpression=expression;return this;};
          query.order=function(column,options){this.orders.push([column,options]);return this;};
          query.limit=function(value){this.requestedLimit=value;return this;};
          query.then=function(resolve,reject){
            queryCalls.push({table:this.table,filters:this.filters,orExpression:this.orExpression,
              orders:this.orders,limit:this.requestedLimit,columns:this.columns,key});
            return Promise.resolve({data:rows.slice(0,this.requestedLimit),error:null}).then(resolve,reject);
          };
          return query;
        }
      };
    }};
  }
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

function order(id,createdAt){
  return {order_id:id.repeat(64),trading_symbol:"TEST",exchange:"NSE",side:"BUY",quantity:1,
    product:"DELIVERY",execution_price_paise:10000,limit_price_paise:null,gross_paise:10000,
    charges_paise:0,charges_breakdown:{},cash_delta_paise:-10000,realized_pnl_paise:0,
    order_type:"MARKET",status:"FILLED",created_at:createdAt};
}
test("GET /paper/orders returns a next cursor when an additional page exists",async()=>{
  queryCalls.length=0;
  rows=[order("a","2026-11-24T12:03:00.000Z"),order("b","2026-11-24T12:02:00.000Z"),order("c","2026-11-24T12:01:00.000Z")];
  const response=await fetch(baseUrl+"/paper/orders?limit=2",{headers:{Authorization:"Bearer "+token}});
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.orders.length,2);
  assert.equal(body.hasMore,true);
  assert.ok(body.nextCursor);
  assert.equal(queryCalls[0].limit,3);
  assert.deepEqual(queryCalls[0].orders,[["created_at",{ascending:false}],["order_id",{ascending:false}]]);
});
test("GET /paper/orders applies a validated cursor and returns no next page when exhausted",async()=>{
  queryCalls.length=0;
  rows=[order("d","2026-11-24T12:00:00.000Z")];
  const cursor=Buffer.from(JSON.stringify({createdAt:"2026-11-24T12:02:00.000Z",orderId:"b".repeat(64)})).toString("base64url");
  const response=await fetch(baseUrl+"/paper/orders?limit=2&cursor="+encodeURIComponent(cursor),{headers:{Authorization:"Bearer "+token}});
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.orders.length,1);
  assert.equal(body.hasMore,false);
  assert.equal(body.nextCursor,null);
  assert.match(queryCalls[0].orExpression,/created_at\.lt\.2026-11-24T12:02:00\.000Z/);
  assert.match(queryCalls[0].orExpression,/order_id\.lt\./);
});
test("GET /paper/orders rejects an invalid cursor before querying user data",async()=>{
  queryCalls.length=0;
  const response=await fetch(baseUrl+"/paper/orders?cursor=invalid!",{headers:{Authorization:"Bearer "+token}});
  const body=await response.json();
  assert.equal(response.status,400);
  assert.match(body.error,/cursor is invalid/i);
  assert.equal(queryCalls.length,0);
});
