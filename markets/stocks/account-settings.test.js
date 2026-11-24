"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "account-settings.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "account-settings.css"), "utf8");

test("mobile OTP uses Supabase phone OTP and verifies only SMS codes", () => {
  assert.match(source, /signInWithOtp\(\{ phone, options: \{ shouldCreateUser: true \} \}\)/);
  assert.match(source, /verifyOtp\(\{ phone, token, type: "sms" \}\)/);
  assert.match(source, /\^\\\+\[1-9\]\\d\{7,14\}\$/);
  assert.match(source, /\^\\d\{4,8\}\$/);
});

test("profile updates only the signed-in user's Auth metadata", () => {
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.match(source, /supabase\.auth\.updateUser\(\{ data: \{ display_name: displayName \} \}\)/);
  assert.match(source, /data\.user\?\.id !== currentUserId/);
});

test("session refresh, auth-state clearing and logout are wired", () => {
  assert.match(source, /supabase\.auth\.refreshSession\(\)/);
  assert.match(source, /supabase\.auth\.onAuthStateChange/);
  assert.match(source, /supabase\.auth\.signOut\(\)/);
  assert.match(source, /function clearWallet\(\)/);
  assert.match(source, /currentUserId = user\?\.id \|\| null/);
});

test("wallet requests use the active user's bearer token and no-store caching", () => {
  assert.match(source, /Authorization: "Bearer " \+ data\.session\.access_token/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /payload\.availableCashPaise/);
  assert.match(source, /ledger reconciliation is not yet enabled/);
  assert.doesNotMatch(source, /service_role|SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY/i);
});

test("account settings layout is responsive and does not expose controls while signed out", () => {
  assert.match(source, /privatePanel\.hidden = true/);
  assert.match(source, /phonePanel\.hidden = false/);
  assert.match(css, /@media\(max-width:520px\)/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});


test("email and password changes are delegated to the active Supabase Auth user", () => {
  assert.ok(source.includes("supabase.auth.updateUser({ email })"));
  assert.ok(source.includes("supabase.auth.updateUser({ password })"));
  assert.ok(source.includes("Email change requested. Complete the confirmation steps sent by Supabase"));
  assert.ok(source.includes("Password updated successfully."));
  assert.ok(source.includes("password.length < 8 || password.length > 128"));
});

test("local UI cannot create a mock identity and private profile writes are guarded against stale sessions", () => {
  assert.doesNotMatch(source, /development-mock-user|DEVELOPMENT MOCK LOGIN|devMockActive|mockButton/);
  assert.match(source, /currentUserId !== userId \|\| authSequence !== sequence/);
  assert.match(source, /let authEventSeen = false/);
  assert.match(source, /if \(authEventSeen\) return/);
});

function createAccountSessionHarness() {
 const elements=new Map();
 class Element {
  constructor(id=""){this.id=id;this.listeners={};this.hidden=false;this.disabled=false;this.value="";this.textContent="";this.children=[];}
  addEventListener(name,fn){(this.listeners[name] ||= []).push(fn);}
  append(...nodes){this.children.push(...nodes);}
  focus(){}
  set innerHTML(markup){for(const m of markup.matchAll(/id="([^"]+)"/g))elements.set(m[1],new Element(m[1]));}
  querySelector(sel){return elements.get(sel.replace(/^#/,""));}
 }
 const host=new Element("connection");elements.set("connection",host);
 let listener,currentSession=null,firstResolve,firstStartedResolve;
 const firstStarted=new Promise(r=>firstStartedResolve=r);
 const firstUser=new Promise(r=>firstResolve=r);
 let userCalls=0;
 const auth={
  onAuthStateChange(fn){listener=fn;},
  async getSession(){return {data:{session:currentSession},error:null};},
  getUser(){userCalls++;if(userCalls===1){firstStartedResolve();return firstUser;}return Promise.resolve({data:{user:{id:"user-2",email:"two@example.test",user_metadata:{display_name:"Second User"}}},error:null});}
 };
 const supabase={auth};
 const document={
  head:new Element("head"),
  getElementById(id){return elements.get(id)||null;},
  createElement(){return new Element();},
  querySelector(){return {content:"https://gateway.example"};}
 };
 const fetch=async(_url,opts)=>({ok:true,json:async()=>({startingCashPaise:100000000,cashPaise:20000,reservedCashPaise:1000,reservedMarginPaise:0,availableCashPaise:19000,ledgerReconciled:false,tokenUsed:opts.headers.Authorization})});
 const vm=require("node:vm");
 vm.runInNewContext(source.replace('import { supabase } from "./supabase-client.js";',"const {supabase}=globalThis.__test;"),{
  document,fetch,queueMicrotask,AbortSignal:{timeout:()=>({})},Intl,globalThis:{__test:{supabase}},console
 });
 return {elements,firstStarted,resolveFirst:()=>firstResolve({data:{user:{id:"user-1",email:"one@example.test",user_metadata:{display_name:"First User"}}},error:null}),switchFirst:()=>{currentSession={user:{id:"user-1"},access_token:"token-user-1"};listener("SIGNED_IN",currentSession);},switchUser:()=>{currentSession={user:{id:"user-2"},access_token:"token-user-2"};listener("SIGNED_IN",currentSession);},switchOut:()=>{currentSession=null;listener("SIGNED_OUT",null);}};
}
test("a delayed previous-user profile response cannot overwrite the newly active account", async()=>{
 const h=createAccountSessionHarness();
 await new Promise(r=>setTimeout(r,0));
 h.switchFirst();
 await h.firstStarted;
 h.switchUser();
 await new Promise(r=>setTimeout(r,0));
 h.resolveFirst();
 await new Promise(r=>setTimeout(r,10));
 assert.equal(h.elements.get("s-trade-display-name").value,"Second User");
 assert.equal(h.elements.get("s-trade-wallet-cash").textContent,"₹200.00");
 assert.equal(h.elements.get("s-trade-session-info").textContent,"Signed in as two@example.test");
 h.switchOut();
 await new Promise(r=>setTimeout(r,0));
 assert.equal(h.elements.get("s-trade-account-private").hidden,true);
 assert.equal(h.elements.get("s-trade-wallet-cash").textContent,"—");
});


test("private mutation and refresh responses are bound to the initiating user and auth sequence", () => {
  assert.ok(source.includes("function isCurrent(userId, sequence)"));
  assert.ok(source.includes("if (!isCurrent(userId, sequence)) return;"));
  assert.ok(source.includes("finally { if (isCurrent(userId, sequence))"));
  assert.ok(source.includes("loadWallet(userId, sequence); if (isCurrent(userId, sequence))"));
});


test("OTP completion messages are ignored after the active auth sequence changes", () => {
  assert.ok(source.includes('const sequence = authSequence;'));
  assert.ok(source.includes('if (sequence === authSequence) await syncAuth(data.session);'));
  assert.ok(source.includes('if (sequence === authSequence) status.textContent = error.message || "OTP verification failed.";'));
});
