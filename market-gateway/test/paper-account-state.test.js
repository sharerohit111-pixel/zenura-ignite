"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizePaperAccountState}=require("../lib/paper-account-state");
const valid=()=>({currency:"INR",startingCashPaise:100000000,cashPaise:100000000,
 positions:{},derivativePositions:{},reservedMarginPaise:0,realizedPnlPaise:0});
test("normalizes valid account state and legacy optional fields",()=>{
 const account=valid();
 delete account.derivativePositions;
 delete account.reservedMarginPaise;
 delete account.realizedPnlPaise;
 const result=normalizePaperAccountState(account);
 assert.deepEqual(result,{currency:"INR",startingCashPaise:100000000,cashPaise:100000000,
  positions:{},derivativePositions:{},reservedMarginPaise:0,realizedPnlPaise:0,updatedAt:null});
});
test("rejects malformed account balances and position containers",()=>{
 const cases=[
  {currency:"USD"},{startingCashPaise:0},{startingCashPaise:Number.MAX_SAFE_INTEGER+1},
  {cashPaise:-1},{cashPaise:Number.MAX_SAFE_INTEGER+1},{positions:null},
  {positions:[]},{derivativePositions:null},{derivativePositions:[]},
  {reservedMarginPaise:-1},{reservedMarginPaise:1.5},
  {realizedPnlPaise:Number.MAX_SAFE_INTEGER+1},{realizedPnlPaise:"0"}
 ];
 for(const patch of cases)assert.equal(normalizePaperAccountState({...valid(),...patch}),null);
});
test("preserves valid negative realized P&L and safe balances",()=>{
 const result=normalizePaperAccountState({...valid(),cashPaise:0,realizedPnlPaise:-12500});
 assert.equal(result.cashPaise,0);assert.equal(result.realizedPnlPaise,-12500);
});
