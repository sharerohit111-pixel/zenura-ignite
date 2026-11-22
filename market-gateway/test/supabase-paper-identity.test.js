"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {
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
function authFor(claims=decodedToken){return {async verifyIdToken(token,checkRevoked){
  assert.equal(token,idToken);
  assert.equal(checkRevoked,true);
  return claims;
}};}
function resolve(a,claims=decodedToken,header="Bearer "+idToken){
  return a.resolveIdentity({request:request(header),auth:authFor(claims)});
}

test("requires a strict Bearer token and Firebase revocation verification",async()=>{
  const a=adapter(async()=>response(supabaseUserId));
  await assert.rejects(resolve(a,decodedToken,"Basic token"),{status:401});
  await assert.rejects(a.resolveIdentity({request:request("Bearer token"),auth:{}}),{status:503});
});

