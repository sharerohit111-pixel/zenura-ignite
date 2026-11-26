"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {marketDateString,loadVerifiedExchangeSession}=require("../lib/exchange-session-calendar");

function mockDb(data,error=null){
 const filters={};
 const query={
  select(columns){this.columns=columns;return this;},
  eq(key,value){filters[key]=value;return this;},
  async maybeSingle(){return {data,error};}
 };
 return {from(table){assert.equal(table,"paper_exchange_sessions");return query;},filters,query};
}
const row={exchange:"NSE",session_date:"2026-11-23",is_trading_day:true,
 open_minute:555,close_minute:930,session_kind:"REGULAR",
 source_reference:"NSE official circular",verified_at:"2026-11-20T04:00:00.000Z",source_sha256:"a".repeat(64)};
const now=Date.parse("2026-11-23T04:30:00.000Z");

test("exchange calendar date is derived in Asia/Kolkata, including UTC day boundaries",()=>{
 assert.equal(marketDateString(Date.parse("2026-11-22T18:30:00.000Z")),"2026-11-23");
 assert.equal(marketDateString(now),"2026-11-23");
});

test("loads only the exact verified NSE session for the current IST date",async()=>{
 const db=mockDb(row);
 assert.deepEqual(await loadVerifiedExchangeSession(db,"NSE",now),{
  exchange:"NSE",sessionDate:"2026-11-23",isTradingDay:true,openMinute:555,closeMinute:930
 });
 assert.deepEqual(db.filters,{exchange:"NSE",session_date:"2026-11-23"});
 assert.ok(db.query.columns.includes("source_sha256"));
});

test("loads an explicitly verified BSE session independently of NSE",async()=>{
 const bseRow={...row,exchange:"BSE",source_reference:"BSE official trading notice"};
 const db=mockDb(bseRow);
 assert.deepEqual(await loadVerifiedExchangeSession(db,"BSE",now),{
  exchange:"BSE",sessionDate:"2026-11-23",isTradingDay:true,openMinute:555,closeMinute:930
 });
 assert.deepEqual(db.filters,{exchange:"BSE",session_date:"2026-11-23"});
});

test("missing, closed, mismatched, malformed or future-verified sessions fail closed",async()=>{
 assert.equal(await loadVerifiedExchangeSession(mockDb(null),"NSE",now),null);
 assert.equal(await loadVerifiedExchangeSession(mockDb({...row,is_trading_day:false,session_kind:"CLOSED",open_minute:null,close_minute:null}),"NSE",now),null);
 assert.equal(await loadVerifiedExchangeSession(mockDb({...row,session_date:"2026-11-24"}),"NSE",now),null);
 assert.equal(await loadVerifiedExchangeSession(mockDb({...row,source_reference:" "}),"NSE",now),null);
 assert.equal(await loadVerifiedExchangeSession(mockDb({...row,source_sha256:null}),"NSE",now),null);
 assert.equal(await loadVerifiedExchangeSession(mockDb({...row,verified_at:"2026-11-23T04:31:00.000Z"}),"NSE",now),null);
 assert.equal(await loadVerifiedExchangeSession(mockDb({...row,session_kind:"UNKNOWN"}),"NSE",now),null);
 assert.equal(await loadVerifiedExchangeSession(mockDb(row),"MCX",now),null);
});

test("calendar read errors fail closed with a service error",async()=>{
 await assert.rejects(()=>loadVerifiedExchangeSession(mockDb(null,{code:"XX"}),"NSE",now),{status:503});
});
