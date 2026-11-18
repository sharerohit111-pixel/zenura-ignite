"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {WATCHLIST_NAMES,normalizeWatchlists}=require("../lib/watchlists");

test("creates all named lists when no saved data exists",()=>{
 assert.deepEqual(normalizeWatchlists({}),{"My Stocks":[],"Banking":[],"NIFTY":[],"F&O":[]});
 assert.deepEqual(WATCHLIST_NAMES,["My Stocks","Banking","NIFTY","F&O"]);
});
test("migrates legacy instrumentKeys into My Stocks only",()=>{
 const result=normalizeWatchlists({instrumentKeys:["NSE_EQ|A","NSE_EQ|B"]});
 assert.deepEqual(result["My Stocks"],["NSE_EQ|A","NSE_EQ|B"]);
 assert.deepEqual(result.Banking,[]);
});
test("prefers named My Stocks over legacy list",()=>{
 const result=normalizeWatchlists({instrumentKeys:["OLD"],watchlists:{"My Stocks":["NEW"]}});
 assert.deepEqual(result["My Stocks"],["NEW"]);
});
test("deduplicates string keys and ignores non-string values",()=>{
 const result=normalizeWatchlists({watchlists:{Banking:["A","A",null,7,"B"]}});
 assert.deepEqual(result.Banking,["A","B"]);
});
test("limits each list to fifty unique keys",()=>{
 const keys=Array.from({length:60},(_,i)=>"KEY"+i);
 const result=normalizeWatchlists({watchlists:{NIFTY:keys}});
 assert.equal(result.NIFTY.length,50);
 assert.equal(result.NIFTY[49],"KEY49");
});
test("ignores unknown list names and malformed watchlists containers",()=>{
 const result=normalizeWatchlists({watchlists:{Other:["X"],Banking:"bad"}});
 assert.deepEqual(result.Banking,[]);
 assert.deepEqual(Object.keys(result),["My Stocks","Banking","NIFTY","F&O"]);
});
