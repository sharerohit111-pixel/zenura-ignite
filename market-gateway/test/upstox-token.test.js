"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {isUpstoxTokenUsable}=require("../lib/upstox-token");
const stamp=ms=>({toMillis:()=>ms});
const encrypted=()=>({v:1,iv:"a".repeat(16),tag:"b".repeat(24),data:"YQ=="});
const valid=()=>({status:"connected",tokenCiphertext:encrypted(),expiresAt:stamp(2000)});

test("accepts a connected encrypted token envelope before expiry",()=>{
 assert.equal(isUpstoxTokenUsable(valid(),1000),true);
});
test("rejects disconnected, missing, or malformed encrypted tokens",()=>{
 assert.equal(isUpstoxTokenUsable({...valid(),status:"revoked"},1000),false);
 assert.equal(isUpstoxTokenUsable({...valid(),tokenCiphertext:null},1000),false);
 assert.equal(isUpstoxTokenUsable({...valid(),tokenCiphertext:"encrypted-token"},1000),false);
 assert.equal(isUpstoxTokenUsable({...valid(),tokenCiphertext:{...encrypted(),v:2}},1000),false);
 assert.equal(isUpstoxTokenUsable({...valid(),tokenCiphertext:{...encrypted(),data:""}},1000),false);
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
