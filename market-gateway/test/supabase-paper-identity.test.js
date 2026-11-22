"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {
  bearerToken,
  buildPaperTradingRpcArgs,
  createSupabasePaperTradingIdentityAdapter
}=require("../lib/supabase-paper-identity");

const projectId="zenura-firebase-prod";
const supabaseUserId="11111111-2222-4333-8444-555555555555";
const idToken="verified-firebase-id-token";
const decodedToken={uid:"firebase-user-123",sub:"firebase-user-123",aud:projectId,iss:"https://securetoken.google.com/"+projectId,role:"authenticated"};
function adapter(fetchImpl){return createSupabasePaperTradingIdentityAdapter({
  supabaseUrl:"https://atvbjibhunvzpmfagagm.supabase.co",
  publishableKey:"sb_publishable_test",
  firebaseProjectId:projectId,
  fetchImpl
});}
function response(body,status=200){return {ok:status>=200&&status<300,status,json:async()=>body};}
function request(header){return {get(name){assert.equal(name,"authorization");return header;}};}

test("extracts only a single non-empty Bearer token",()=>{
  assert.equal(bearerToken(request("Bearer token-123")),"token-123");
  assert.equal(bearerToken(request("bearer token-123")),"token-123");
  for(const value of [undefined,"","Basic abc","Bearer ","Bearer a b","Bearer a,b"])
    assert.throws(()=>bearerToken(request(value)),{status:401});
});

test("resolves Firebase UID through authenticated Supabase identity RPC",async()=>{
  let call;
  const result=await adapter(async(url,options)=>{call={url,options};return response(supabaseUserId);})
    .resolveIdentity({idToken,decodedToken});
  assert.equal(result.firebaseUid,decodedToken.uid);
  assert.equal(result.supabaseUserId,supabaseUserId);
  assert.equal(call.url,"https://atvbjibhunvzpmfagagm.supabase.co/rest/v1/rpc/current_paper_user_id");
  assert.equal(call.options.method,"POST");
  assert.equal(call.options.headers.apikey,"sb_publishable_test");
  assert.equal(call.options.headers.Authorization,"Bearer "+idToken);
  assert.equal(call.options.body,"{}");
  assert.equal(Object.isFrozen(result),true);
});

test("rejects missing token and malformed verified identity",async()=>{
  const a=adapter(async()=>response(supabaseUserId));
  await assert.rejects(a.resolveIdentity({decodedToken}),{status:401});
  await assert.rejects(a.resolveIdentity({idToken,decodedToken:{...decodedToken,sub:"other"}}),{status:401});
  await assert.rejects(a.resolveIdentity({idToken,decodedToken:{...decodedToken,uid:""}}),{status:401});
});

test("rejects Firebase tokens from a different project",async()=>{
  const a=adapter(async()=>response(supabaseUserId));
  await assert.rejects(a.resolveIdentity({idToken,decodedToken:{...decodedToken,aud:"other-project"}}),{status:401});
  await assert.rejects(a.resolveIdentity({idToken,decodedToken:{...decodedToken,iss:"https://securetoken.google.com/other-project"}}),{status:401});
});

test("fails closed when Firebase JWT lacks authenticated role claim",async()=>{
  const a=adapter(async()=>response(supabaseUserId));
  await assert.rejects(a.resolveIdentity({idToken,decodedToken:{...decodedToken,role:undefined}}),{status:403});
});

test("rejects missing identity mapping without inventing a UUID",async()=>{
  const a=adapter(async()=>response(null));
  await assert.rejects(a.resolveIdentity({idToken,decodedToken}),{status:403,message:"Paper trading identity is not provisioned"});
});

test("fails closed for Supabase auth/configuration errors and malformed responses",async()=>{
  await assert.rejects(adapter(async()=>response({message:"private"},401)).resolveIdentity({idToken,decodedToken}),{status:503});
  await assert.rejects(adapter(async()=>response("not-a-uuid")).resolveIdentity({idToken,decodedToken}),{status:503});
  await assert.rejects(adapter(async()=>{throw new Error("network secret");}).resolveIdentity({idToken,decodedToken}),{status:503});
});

test("requires HTTPS origin, publishable key and Firebase project ID",()=>{
  assert.throws(()=>createSupabasePaperTradingIdentityAdapter({supabaseUrl:"http://localhost:54321",publishableKey:"k",firebaseProjectId:projectId,fetchImpl:async()=>{}}),/HTTPS/);
  assert.throws(()=>createSupabasePaperTradingIdentityAdapter({supabaseUrl:"https://x.supabase.co",firebaseProjectId:projectId,fetchImpl:async()=>{}}),/publishable key/);
  assert.throws(()=>createSupabasePaperTradingIdentityAdapter({supabaseUrl:"https://x.supabase.co",publishableKey:"k",firebaseProjectId:"bad",fetchImpl:async()=>{}}),/Firebase project ID/);
});

test("injects only the resolved Supabase UUID into allowlisted trading RPC args",async()=>{
  const identity=await adapter(async()=>response(supabaseUserId)).resolveIdentity({idToken,decodedToken});
  const args=buildPaperTradingRpcArgs(identity,"execute_paper_market_order",{p_order_id:"order-1",p_quantity:2});
  assert.deepEqual(args,{p_order_id:"order-1",p_quantity:2,p_user_id:supabaseUserId});
  assert.equal(Object.isFrozen(args),true);
});

test("prevents forged identities and non-allowlisted RPC calls",async()=>{
  assert.throws(()=>buildPaperTradingRpcArgs({supabaseUserId},"execute_paper_market_order",{}),{status:401});
  const identity=await adapter(async()=>response(supabaseUserId)).resolveIdentity({idToken,decodedToken});
  assert.throws(()=>buildPaperTradingRpcArgs(identity,"unknown_admin_rpc",{}),{status:400});
});

test("rejects user-id overrides even for a resolved identity",async()=>{
  const identity=await adapter(async()=>response(supabaseUserId)).resolveIdentity({idToken,decodedToken});
  assert.throws(()=>buildPaperTradingRpcArgs(identity,"execute_paper_market_order",{p_user_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}),{status:400});
  assert.throws(()=>buildPaperTradingRpcArgs(identity,"execute_paper_market_order",[]),{status:400});
});
