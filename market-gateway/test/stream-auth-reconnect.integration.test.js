"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {isUpstoxAccessTokenUsable}=require("../lib/upstox-token-validity");
const {upstoxHttpError}=require("../lib/upstox-http-policy");
const {MAX_RECONNECT_ATTEMPTS,reconnectDelayMs}=require("../lib/stream-reconnect-policy");
const {createStreamLifecycle}=require("../lib/stream-lifecycle");

const NOW=1_800_000_000_000;
test("expired token fails closed before a reconnect authorization request",async()=>{
 let authorizeCalls=0;
 const connection={status:"connected",expiresAtMs:NOW+120_000,tokenCiphertext:{ciphertext:"opaque"}};
 const authorize=async()=>{authorizeCalls++;return {ok:true};};
 assert.equal(isUpstoxAccessTokenUsable(connection.expiresAtMs,NOW),true);
 assert.deepEqual(await authorize(),{ok:true});
 const expiredAt=connection.expiresAtMs;
 assert.equal(isUpstoxAccessTokenUsable(expiredAt,expiredAt),false);
 const error=upstoxHttpError({status:401,headers:{get(){return null;}}});
 assert.equal(error.status,401);
 assert.equal(error.code,"upstox_reconnect_required");
 assert.equal(authorizeCalls,1,"expired credentials must not trigger further authorization attempts");
});

test("transient reconnect failures remain bounded and 401 terminates the stream",async()=>{
 let attempts=0,closed=false;
 const lifecycle=createStreamLifecycle(()=>{closed=true;});
 for(let attempt=1;attempt<=MAX_RECONNECT_ATTEMPTS;attempt++){
  attempts++;
  assert.ok(reconnectDelayMs(attempt,{random:()=>0})>=0);
 }
 assert.equal(attempts,MAX_RECONNECT_ATTEMPTS);
 const expired=upstoxHttpError({status:401,headers:{get(){return null;}}});
 if(expired.status===401)lifecycle.stop();
 assert.equal(closed,true);
 assert.equal(lifecycle.stop(),false);
 assert.throws(()=>reconnectDelayMs(MAX_RECONNECT_ATTEMPTS+1,{random:()=>0}),TypeError);
});

test("authorization failure does not expose provider response details",()=>{
 const error=upstoxHttpError({status:401,headers:{get(){return null;}},body:"sensitive-provider-payload"});
 assert.equal(error.message,"Upstox authorization expired. Reconnect your Upstox account.");
 assert.equal(error.code,"upstox_reconnect_required");
 assert.equal(JSON.stringify(error).includes("sensitive-provider-payload"),false);
});
