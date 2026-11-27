"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {isOAuthStateUsable} = require("../lib/upstox-oauth-state");
const stamp = ms => ({toMillis: () => ms});

test("accepts an unused state owned by a user before expiry", () => {
  assert.equal(isOAuthStateUsable({uid:"user-1",used:false,expiresAt:stamp(2000)},1000),true);
});
test("rejects missing state, missing owner, and empty owner", () => {
  assert.equal(isOAuthStateUsable(null,1000),false);
  assert.equal(isOAuthStateUsable({used:false,expiresAt:stamp(2000)},1000),false);
  assert.equal(isOAuthStateUsable({uid:"",used:false,expiresAt:stamp(2000)},1000),false);
});
test("rejects used state to prevent callback replay", () => {
  assert.equal(isOAuthStateUsable({uid:"user-1",used:true,expiresAt:stamp(2000)},1000),false);
});
test("rejects expired state, including exact expiry", () => {
  assert.equal(isOAuthStateUsable({uid:"user-1",used:false,expiresAt:stamp(1000)},1000),false);
  assert.equal(isOAuthStateUsable({uid:"user-1",used:false,expiresAt:stamp(999)},1000),false);
});
test("rejects missing or malformed expiry", () => {
  assert.equal(isOAuthStateUsable({uid:"user-1",used:false},1000),false);
  assert.equal(isOAuthStateUsable({uid:"user-1",used:false,expiresAt:{toMillis:()=>NaN}},1000),false);
});

test("rejects timestamp accessors that throw instead of failing the callback", () => {
  assert.equal(isOAuthStateUsable({uid:"user-1",used:false,expiresAt:{toMillis:()=>{throw Error("corrupt timestamp");}}},1000),false);
});
test("rejects unsafe clocks and non-integer expiry values", () => {
  const state={uid:"user-1",used:false,expiresAt:stamp(2000)};
  for (const now of [-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN]) assert.equal(isOAuthStateUsable(state,now),false);
  assert.equal(isOAuthStateUsable({...state,expiresAt:stamp(2000.5)},1000),false);
});
