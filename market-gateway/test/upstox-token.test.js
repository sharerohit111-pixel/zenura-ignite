"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {isUpstoxTokenUsable}=require("../lib/upstox-token");
const stamp=ms=>({toMillis:()=>ms});
const valid=()=>({status:"connected",tokenCiphertext:"encrypted-token",expiresAt:stamp(2000)});

test("accepts a connected encrypted token before expiry",()=>{
 assert.equal(isUpstoxTokenUsable(valid(),1000),true);
});
test("rejects disconnected, missing, or empty encrypted tokens",()=>{
 assert.equal(isUpstoxTokenUsable({...valid(),status:"revoked"},1000),false);
 assert.equal(isUpstoxTokenUsable({...valid(),tokenCiphertext:""},1000),false);
 assert.equal(isUpstoxTokenUsable(null,1000),false);
});
test("rejects expired tokens including exact expiry",()=>{
 assert.equal(isUpstoxTokenUsable(valid(),2000),false);
 assert.equal(isUpstoxTokenUsable(valid(),2001),false);
});
test("rejects missing, malformed, or throwing expiry values",()=>{
 assert.equal(isUpstoxTokenUsable({...valid(),expiresAt:null},1000),false);
 assert.equal(isUpstoxTokenUsable({...valid(),expiresAt:{toMillis:()=>NaN}},1000),false);
 assert.equal(isUpstoxTokenUsable({...valid(),expiresAt:{toMillis:()=>{throw Error("bad timestamp");}}},1000),false);
});
test("rejects unsafe clock values",()=>{
 assert.equal(isUpstoxTokenUsable(valid(),-1),false);
 assert.equal(isUpstoxTokenUsable(valid(),1.5),false);
});
