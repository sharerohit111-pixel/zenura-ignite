"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createSTradeRouter}=require("../lib/s-trade-notifications-admin-router");

function harness({admin=false,notificationRows=[],failAdminLookup=false}={}){
 const routes=[];
 const express={Router(){return {get:(p,...h)=>routes.push(["GET",p,h.at(-1)]),post:(p,...h)=>routes.push(["POST",p,h.at(-1)]),put:(p,...h)=>routes.push(["PUT",p,h.at(-1)]),delete:(p,...h)=>routes.push(["DELETE",p,h.at(-1)])};}};
 const db={
  from(table){
   const state={table,filters:[],updates:null,inserts:null};
   const q={
    select(...args){state.select=args;return q;},eq(k,v){state.filters.push([k,v]);return q;},
    is(k,v){state.filters.push([k,v]);return q;},order(){return q;},limit(){return q;},
    update(v){state.updates=v;return q;},insert(v){state.inserts=v;return q;},
    upsert(v){state.inserts=v;return q;},delete(){state.deleted=true;return q;},
    maybeSingle:async()=>table==="s_trade_admins"?{data:admin?{user_id:"11111111-2222-4333-8444-555555555555"}:null,error:failAdminLookup?{message:"down"}:null}:{data:null,error:null},
    single:async()=>({data:{user_id:"11111111-2222-4333-8444-555555555555"},error:null}),
    then(resolve){resolve({data:notificationRows,error:null,count:notificationRows.length});}
   };return q;
  },
  auth:{admin:{listUsers:async()=>({data:{users:[]},error:null}),updateUserById:async()=>({data:{},error:null})}}
 };
 const router=createSTradeRouter({express,serviceDb:db,authenticate:async()=>({user:{id:"11111111-2222-4333-8444-555555555555"}})});
 return {routes,router};
}
function response(){
 return {statusCode:200,headers:{},status(n){this.statusCode=n;return this;},set(k,v){this.headers[k]=v;return this;},json(v){this.body=v;return this;}};
}
test("registers user notification, preference, price alert and admin surfaces",()=>{
 const {routes}=harness();
 for(const expected of [["GET","/notifications"],["POST","/notifications/:id/read"],["GET","/preferences"],["PUT","/preferences"],["GET","/price-alerts"],["POST","/price-alerts"],["DELETE","/price-alerts/:id"],["GET","/admin/overview"],["GET","/admin/users"],["GET","/admin/providers"],["GET","/admin/audit"],["POST","/admin/controls/:key"]]){
  assert.ok(routes.some(r=>r[0]===expected[0]&&r[1]===expected[1]),expected.join(" "));
 }
});
test("admin endpoints fail closed without a database-backed administrator record",async()=>{
 const {routes}=harness({admin:false});
 const route=routes.find(r=>r[1]==="/admin/users")[2],res=response();
 await route({query:{}},res);
 assert.equal(res.statusCode,403);
 assert.match(res.body.error,/Administrator/);
});
test("admin endpoints fail closed when the administrator registry cannot be read",async()=>{
 const {routes}=harness({admin:false,failAdminLookup:true});
 const route=routes.find(r=>r[1]==="/admin/users")[2],res=response();
 await route({query:{}},res);
 assert.equal(res.statusCode,503);
});
