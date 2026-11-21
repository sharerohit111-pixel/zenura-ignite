"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizePaperAccountState,ensurePaperAccount}=require("../lib/paper-account-state");

function makeDb(existing){
 const state={value:existing?{...existing}:null,writes:[]};
 const db={runTransaction:async callback=>callback({
  get:async()=>({exists:state.value!==null,data:()=>state.value}),
  create:(_ref,value)=>{state.writes.push(["create",value]);state.value=value;},
  update:(_ref,patch)=>{state.writes.push(["update",patch]);state.value={...state.value,...patch};}
 })};
 return {db,state};
}

test("normalizes a valid INR paper account with empty optional maps",()=>{
 const result=normalizePaperAccountState({currency:"INR",startingCashPaise:100000000,cashPaise:100000000});
 assert.deepEqual(result,{currency:"INR",startingCashPaise:100000000,cashPaise:100000000,positions:{},intradayPositions:{},derivativePositions:{},reservedMarginPaise:0,reservedCashPaise:0,reservedPositions:{},intradayReservedPositions:{},realizedPnlPaise:0,deliveryRealizedPnlPaise:0,intradayRealizedPnlPaise:0,updatedAt:null});
});

test("normalizes Firestore timestamp without exposing account internals",()=>{
 const result=normalizePaperAccountState({currency:"INR",startingCashPaise:1000,cashPaise:900,positions:{},derivativePositions:{},reservedMarginPaise:100,realizedPnlPaise:-25,updatedAt:{toMillis:()=>1234},version:8,privateSecret:"never-return"});
 assert.equal(result.updatedAt,1234);
 assert.equal(Object.hasOwn(result,"version"),false);
 assert.equal(Object.hasOwn(result,"privateSecret"),false);
});

test("rejects malformed account identity, currency, balances and maps",()=>{
 const valid={currency:"INR",startingCashPaise:1000,cashPaise:900,positions:{},derivativePositions:{},reservedMarginPaise:0,realizedPnlPaise:0};
 for(const patch of [
  {currency:"USD"},{startingCashPaise:0},{startingCashPaise:1.5},{cashPaise:-1},
  {cashPaise:Number.MAX_SAFE_INTEGER+1},{positions:null},{positions:[]},
  {derivativePositions:"bad"},{reservedMarginPaise:-1},{reservedCashPaise:-1},{reservedCashPaise:901},{reservedPositions:[]},{reservedPositions:{"NSE_EQ|BAD":1}},{realizedPnlPaise:1.2}
 ]) assert.equal(normalizePaperAccountState({...valid,...patch}),null);
});

test("rejects null, arrays and primitive account documents",()=>{
 for(const value of [null,[], "bad", 0])assert.equal(normalizePaperAccountState(value),null);
});

test("initializes a missing account once with INR virtual cash and empty positions",async()=>{
 const {db,state}=makeDb(null);
 await ensurePaperAccount({db,ref:{id:"user-1"},startingCashPaise:100000000,serverTimestamp:()=>"server-time"});
 assert.equal(state.writes.length,1);
 assert.equal(state.writes[0][0],"create");
 assert.deepEqual(state.value,{currency:"INR",startingCashPaise:100000000,cashPaise:100000000,positions:{},intradayPositions:{},derivativePositions:{},reservedMarginPaise:0,reservedCashPaise:0,reservedPositions:{},intradayReservedPositions:{},realizedPnlPaise:0,deliveryRealizedPnlPaise:0,intradayRealizedPnlPaise:0,createdAt:"server-time",updatedAt:"server-time",version:1});
});

test("does not reset an existing account balance or holdings",async()=>{
 const original={currency:"INR",startingCashPaise:100000000,cashPaise:45000000,positions:{"NSE_EQ|ABC":{quantity:5,averagePricePaise:10000}},derivativePositions:{},reservedMarginPaise:0,reservedCashPaise:0,reservedPositions:{},realizedPnlPaise:2500,version:7};
 const {db,state}=makeDb(original);
 await ensurePaperAccount({db,ref:{id:"user-1"},startingCashPaise:999999999,serverTimestamp:()=>"new-time"});
 assert.equal(state.writes.length,1);
 assert.equal(state.writes[0][0],"update");
 assert.equal(state.writes[0][1].deliveryRealizedPnlPaise,2500);
 assert.equal(state.writes[0][1].intradayRealizedPnlPaise,0);
 assert.equal(state.value.cashPaise,45000000);
 assert.equal(state.value.version,7);
 assert.equal(state.value.positions["NSE_EQ|ABC"].quantity,5);
});

test("repairs only absent legacy maps and margin fields",async()=>{
 const {db,state}=makeDb({currency:"INR",startingCashPaise:1000,cashPaise:700,realizedPnlPaise:10,version:2});
 await ensurePaperAccount({db,ref:{id:"user-1"},startingCashPaise:9999,serverTimestamp:()=>"server-time"});
 assert.deepEqual(state.writes,[["update",{positions:{},intradayPositions:{},derivativePositions:{},reservedMarginPaise:0,reservedCashPaise:0,reservedPositions:{},intradayReservedPositions:{},deliveryRealizedPnlPaise:10,intradayRealizedPnlPaise:0,updatedAt:"server-time"}]]);
 assert.equal(state.value.cashPaise,700);
 assert.equal(state.value.startingCashPaise,1000);
});

test("refuses to create an account without a valid configured virtual balance",async()=>{
 for(const startingCashPaise of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1]){
  const {db,state}=makeDb(null);
  await assert.rejects(ensurePaperAccount({db,ref:{id:"user-1"},startingCashPaise,serverTimestamp:()=>"server-time"}),{status:503});
  assert.deepEqual(state.writes,[]);
 }
});

test("rejects incomplete transaction dependencies",async()=>{
 await assert.rejects(ensurePaperAccount({db:{},ref:{id:"user-1"},startingCashPaise:1000,serverTimestamp:()=>0}),TypeError);
});

test("normalizes and validates separate Intraday holdings and reservations",()=>{
 const base={currency:"INR",startingCashPaise:10000,cashPaise:9000,positions:{"NSE_EQ|A":{quantity:2}},intradayPositions:{"NSE_EQ|A":{quantity:3}},
  reservedPositions:{"NSE_EQ|A":1},intradayReservedPositions:{"NSE_EQ|A":2},realizedPnlPaise:50};
 const result=normalizePaperAccountState(base);
 assert.deepEqual(result.intradayPositions,base.intradayPositions);
 assert.deepEqual(result.intradayReservedPositions,base.intradayReservedPositions);
 assert.equal(result.deliveryRealizedPnlPaise,50);
 assert.equal(result.intradayRealizedPnlPaise,0);
 assert.equal(normalizePaperAccountState({...base,intradayReservedPositions:{"NSE_EQ|A":4}}),null);
 assert.equal(normalizePaperAccountState({...base,intradayPositions:[]}),null);
});
