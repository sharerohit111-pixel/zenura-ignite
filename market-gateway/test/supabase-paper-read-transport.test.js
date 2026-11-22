"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createSupabasePaperReadTransport}=require("../lib/supabase-paper-read-transport");

const uid="11111111-2222-4333-8444-555555555555";
const token="verified-firebase-token";
function request(){return {get(name){assert.equal(name,"authorization");return "Bearer "+token;}};}
function adapter(){return {async resolveIdentity(context){assert.equal(context.request.get("authorization"),"Bearer "+token);assert.ok(context.auth);return {firebaseUid:"firebase-user",supabaseUserId:uid};}};}
function response(body,status=200){return {ok:status>=200&&status<300,status,json:async()=>body};}
function transport(fetchImpl){return createSupabasePaperReadTransport({
  supabaseUrl:"https://atvbjibhunvzpmfagagm.supabase.co",
  publishableKey:"sb_publishable_test",
  identityAdapter:adapter(),fetchImpl
});}
const context={request:request(),auth:{verified:true}};

test("reads account using Firebase JWT and resolved user UUID, never service role",async()=>{
  let call;
  const result=await transport(async(url,options)=>{call={url,options};return response([{user_id:uid,cash_paise:100000000}]);}).getAccount(context);
  const url=new URL(call.url);
  assert.equal(url.pathname,"/rest/v1/paper_accounts");
  assert.equal(url.searchParams.get("user_id"),"eq."+uid);
  assert.equal(url.searchParams.get("limit"),"1");
  assert.equal(call.options.method,"GET");
  assert.equal(call.options.headers.apikey,"sb_publishable_test");
  assert.equal(call.options.headers.Authorization,"Bearer "+token);
  assert.equal(result.cash_paise,100000000);
  assert.equal(Object.hasOwn(call.options.headers,"service-role"),false);
});

test("lists all supported user-scoped read resources with stable order history",async()=>{
  const calls=[];
  const t=transport(async(url,options)=>{calls.push({url,options});return response([]);});
  await t.listEquityPositions(context);
  await t.listDerivativePositions(context);
  await t.listOrders(context);
  await t.listDerivativeOrders(context);
  await t.listWatchlists(context);
  assert.deepEqual(calls.map(x=>new URL(x.url).pathname.split("/").pop()),[
    "paper_equity_positions","paper_derivative_positions","paper_orders","paper_derivative_orders","paper_watchlists"
  ]);
  for(const call of calls){
    const url=new URL(call.url);
    assert.equal(url.searchParams.get("user_id"),"eq."+uid);
    assert.equal(call.options.headers.Authorization,"Bearer "+token);
    assert.equal(call.options.headers.apikey,"sb_publishable_test");
  }
  assert.equal(new URL(calls[2].url).searchParams.get("order"),"created_at.desc,order_id.desc");
  assert.equal(new URL(calls[3].url).searchParams.get("order"),"created_at.desc,order_id.desc");
});

test("supports bounded pagination and rejects invalid table, limit, and offset",async()=>{
  let requested;
  const t=transport(async(url)=>{requested=new URL(url);return response([]);});
  await t.listOrders({...context,limit:25,offset:50});
  assert.equal(requested.searchParams.get("limit"),"25");
  assert.equal(requested.searchParams.get("offset"),"50");
  await assert.rejects(t.listOrders({...context,limit:101}),{status:400});
  await assert.rejects(t.listOrders({...context,offset:-1}),{status:400});
});

test("returns null for a not-yet-initialized account",async()=>{
  assert.equal(await transport(async()=>response([])).getAccount(context),null);
});

test("fails closed on missing bearer token, transport errors, non-OK responses, and invalid JSON shape",async()=>{
  const t=transport(async()=>response([]));
  await assert.rejects(t.getAccount({request:{get:()=>""},auth:{}}),{status:401});
  await assert.rejects(transport(async()=>{throw new Error("private network detail");}).listWatchlists(context),{status:503});
  await assert.rejects(transport(async()=>response({message:"private"},403)).listWatchlists(context),{status:503});
  await assert.rejects(transport(async()=>response({not:"an array"})).listWatchlists(context),{status:503});
});

test("requires HTTPS, publishable key, identity adapter, and fetch implementation",()=>{
  assert.throws(()=>createSupabasePaperReadTransport({supabaseUrl:"http://localhost",publishableKey:"k",identityAdapter:adapter(),fetchImpl:async()=>{}}),/HTTPS/);
  assert.throws(()=>createSupabasePaperReadTransport({supabaseUrl:"https://x.supabase.co",identityAdapter:adapter(),fetchImpl:async()=>{}}),/publishable key/);
  assert.throws(()=>createSupabasePaperReadTransport({supabaseUrl:"https://x.supabase.co",publishableKey:"k",fetchImpl:async()=>{}}),/identity adapter/);
  assert.throws(()=>createSupabasePaperReadTransport({supabaseUrl:"https://x.supabase.co",publishableKey:"k",identityAdapter:adapter()}),/fetch implementation/);
});
