"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {connectionStatus}=require("../lib/upstox-connection-status");
const stamp=ms=>({toMillis:()=>ms});

test("missing connection is not connected",()=>{
  assert.deepEqual(connectionStatus(null,1000),{connected:false,feedReady:false,status:"not_connected",expiresAt:null});
});
test("valid connected token is authorized but feed is not claimed ready",()=>{
  assert.deepEqual(connectionStatus({status:"connected",expiresAt:stamp(2000)},1000),{
    connected:true,feedReady:false,status:"authorized_feed_not_configured",expiresAt:2000
  });
});
test("expired token is not connected",()=>{
  assert.equal(connectionStatus({status:"connected",expiresAt:stamp(1000)},1000).status,"token_expired");
  assert.equal(connectionStatus({status:"connected",expiresAt:stamp(999)},1000).connected,false);
});
test("disconnected record with future expiry is not reported connected",()=>{
  assert.equal(connectionStatus({status:"revoked",expiresAt:stamp(5000)},1000).status,"not_connected");
  assert.equal(connectionStatus({status:"revoked",expiresAt:stamp(5000)},1000).connected,false);
});
test("malformed expiry is rejected",()=>{
  assert.equal(connectionStatus({status:"connected",expiresAt:{toMillis:()=>NaN}},1000).connected,false);
});

test("malformed throwing expiry and unsafe clock are handled without throwing",()=>{
  assert.equal(connectionStatus({status:"connected",expiresAt:{toMillis:()=>{throw Error("bad");}}},1000).connected,false);
  assert.equal(connectionStatus({status:"connected",expiresAt:stamp(2000)},-1).connected,false);
});
