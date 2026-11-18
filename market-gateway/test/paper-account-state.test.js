"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizePaperAccountState,ensurePaperAccount}=require("../lib/paper-account-state");
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

function transactionDb(account){
 const writes=[];
 return {writes,db:{async runTransaction(callback){
  const tx={
   async get(){return {exists:account!==null,data:()=>account};},
   create(ref,data){writes.push({type:"create",data});},
   update(ref,data){writes.push({type:"update",data});}
  };
  return callback(tx);
 }}};
}
test("existing paper account remains accessible without starting cash configuration",async()=>{
 const account={currency:"INR",startingCashPaise:100000000,cashPaise:43210000,
  positions:{"NSE_EQ|ABC":{quantity:3}},derivativePositions:{},reservedMarginPaise:0,realizedPnlPaise:0};
 const {db,writes}=transactionDb(account);
 await ensurePaperAccount({db,ref:{id:"user-1"},startingCashPaise:null,serverTimestamp:()=>"timestamp"});
 assert.deepEqual(writes,[]);
 assert.equal(account.cashPaise,43210000);
 assert.equal(account.positions["NSE_EQ|ABC"].quantity,3);
});
test("new paper account is created only with a valid configured starting balance",async()=>{
 const {db,writes}=transactionDb(null);
 await ensurePaperAccount({db,ref:{id:"user-2"},startingCashPaise:100000000,serverTimestamp:()=>"timestamp"});
 assert.equal(writes.length,1);
 assert.equal(writes[0].type,"create");
 assert.equal(writes[0].data.cashPaise,100000000);
 assert.equal(writes[0].data.startingCashPaise,100000000);
});
test("missing starting cash configuration blocks only new account creation",async()=>{
 const {db,writes}=transactionDb(null);
 await assert.rejects(ensurePaperAccount({db,ref:{id:"user-3"},startingCashPaise:null,serverTimestamp:()=>"timestamp"}),{status:503});
 assert.deepEqual(writes,[]);
});
test("legacy account migration adds missing fields without replacing balances or holdings",async()=>{
 const account={currency:"INR",startingCashPaise:100000000,cashPaise:76543210,
  positions:{"NSE_EQ|ABC":{quantity:7}},realizedPnlPaise:-1200};
 const {db,writes}=transactionDb(account);
 await ensurePaperAccount({db,ref:{id:"user-4"},startingCashPaise:null,serverTimestamp:()=>"migration-time"});
 assert.equal(writes.length,1);
 assert.equal(writes[0].type,"update");
 assert.deepEqual(writes[0].data,{derivativePositions:{},reservedMarginPaise:0,updatedAt:"migration-time"});
 assert.equal(account.cashPaise,76543210);
 assert.equal(account.positions["NSE_EQ|ABC"].quantity,7);
 assert.equal(account.realizedPnlPaise,-1200);
});

test("legacy account migration restores a missing cash-equity positions map",async()=>{
 const account={currency:"INR",startingCashPaise:100000000,cashPaise:76543210,realizedPnlPaise:0};
 const {db,writes}=transactionDb(account);
 await ensurePaperAccount({db,ref:{id:"user-5"},startingCashPaise:null,serverTimestamp:()=>"migration-time"});
 assert.equal(writes.length,1);
 assert.deepEqual(writes[0].data.positions,{});
 assert.deepEqual(writes[0].data.derivativePositions,{});
 assert.equal(writes[0].data.reservedMarginPaise,0);
 assert.equal(account.cashPaise,76543210);
});
