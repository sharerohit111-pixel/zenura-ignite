import test from "node:test";
import assert from "node:assert/strict";
import {partitionPrivateWatchlistItems,isCurrentWatchlistRequest,mutatePrivateWatchlist} from "../../markets/stocks/demo-watchlist-state.mjs";
const catalog=[{instrumentKey:"MOCK|NSE|EQ|0001"},{instrumentKey:"MOCK|NSE|INDEX|0003"}];
test("private list restore separates canonical MOCK items and preserves existing official entries",()=>{
 const items=[{instrument_key:"MOCK|NSE|EQ|0001"},{instrument_key:"NSE_EQ|123"}];
 const result=partitionPrivateWatchlistItems(items,catalog);
 assert.deepEqual(result.visible,[items[0]]);assert.deepEqual(result.preserved,[items[1]]);
});
test("private watchlist add/remove/reorder prevents duplicates and enforces the 50 item cap",()=>{
 const a={instrument_key:"MOCK|NSE|EQ|0001"},b={instrument_key:"MOCK|NSE|INDEX|0003"};
 let list=mutatePrivateWatchlist([], {type:"add",item:a});
 list=mutatePrivateWatchlist(list,{type:"add",item:a});assert.equal(list.length,1);
 list=mutatePrivateWatchlist(list,{type:"add",item:b});assert.deepEqual(list,[a,b]);
 list=mutatePrivateWatchlist(list,{type:"move",index:1,delta:-1});assert.deepEqual(list,[b,a]);
 list=mutatePrivateWatchlist(list,{type:"remove",instrumentKey:b.instrument_key});assert.deepEqual(list,[a]);
 const full=Array.from({length:50},(_,i)=>({instrument_key:"MOCK|NSE|EQ|"+i}));
 assert.equal(mutatePrivateWatchlist(full,{type:"add",item:{instrument_key:"EXTRA"}}).length,50);
});
test("session switching and list switching invalidate stale API responses",()=>{
 const state={disposed:false,requestSeq:7,userId:"user-a",listName:"My Stocks",editSeq:2};
 const request={requestSeq:7,userId:"user-a",listName:"My Stocks"};
 assert.equal(isCurrentWatchlistRequest(state,request),true);
 assert.equal(isCurrentWatchlistRequest({...state,userId:"user-b"},request),false);
 assert.equal(isCurrentWatchlistRequest({...state,listName:"Banking"},request),false);
 assert.equal(isCurrentWatchlistRequest({...state,requestSeq:8},request),false);
 assert.equal(isCurrentWatchlistRequest({...state,disposed:true},request),false);
});
test("late mutation responses cannot overwrite a newer edit",()=>{
 const state={disposed:false,requestSeq:8,userId:"user-a",listName:"My Stocks",editSeq:4};
 assert.equal(isCurrentWatchlistRequest(state,{requestSeq:8,userId:"user-a",listName:"My Stocks",editSeq:3}),false);
 assert.equal(isCurrentWatchlistRequest(state,{requestSeq:8,userId:"user-a",listName:"My Stocks",editSeq:4}),true);
});
