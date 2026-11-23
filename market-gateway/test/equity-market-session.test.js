"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {loadVerifiedExchangeSession}=require("../lib/exchange-session-calendar");
const {isIntradaySessionOpen}=require("../lib/intraday-limit-policy");

function sessionDb(row){
  const filters={};
  const query={
    select(){return this;},
    eq(key,value){filters[key]=value;return this;},
    async maybeSingle(){return {data:row,error:null};}
  };
  return {from(table){assert.equal(table,"paper_exchange_sessions");return query;},filters};
}
const now=Date.parse("2026-11-23T04:30:00.000Z");
const regular={
  exchange:"NSE",session_date:"2026-11-23",is_trading_day:true,
  open_minute:555,close_minute:930,session_kind:"REGULAR",
  source_reference:"https://www.nseindia.com/market-data/market-timings",
  verified_at:"2026-11-20T04:00:00.000Z",source_sha256:"a".repeat(64)
};

test("cash MARKET policy accepts current time and quote only inside verified NSE session",async()=>{
  const session=await loadVerifiedExchangeSession(sessionDb(regular),"NSE",now);
  assert.ok(session);
  assert.equal(isIntradaySessionOpen(now,session),true);
  assert.equal(isIntradaySessionOpen(Date.parse("2026-11-23T04:29:00.000Z"),session),true);
  assert.equal(isIntradaySessionOpen(Date.parse("2026-11-23T03:44:00.000Z"),session),false);
  assert.equal(isIntradaySessionOpen(Date.parse("2026-11-23T10:00:00.000Z"),session),false);
  assert.equal(isIntradaySessionOpen(Date.parse("2026-11-22T04:30:00.000Z"),session),false);
});

test("cash MARKET policy honors a verified special-session window",async()=>{
  const special={...regular,session_kind:"SPECIAL",open_minute:600,close_minute:780};
  const session=await loadVerifiedExchangeSession(sessionDb(special),"NSE",now);
  assert.ok(session);
  assert.equal(isIntradaySessionOpen(now,session),true);
  assert.equal(isIntradaySessionOpen(Date.parse("2026-11-23T03:59:00.000Z"),session),false);
  assert.equal(isIntradaySessionOpen(Date.parse("2026-11-23T07:00:00.000Z"),session),false);
});

test("cash MARKET policy fails closed when no verified calendar row exists",async()=>{
  const session=await loadVerifiedExchangeSession(sessionDb(null),"NSE",now);
  assert.equal(session,null);
  assert.equal(isIntradaySessionOpen(now,session),false);
});
