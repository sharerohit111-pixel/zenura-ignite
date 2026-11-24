"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const market=require("../mock/fixtures/market.json");
const derivatives=require("../mock/fixtures/derivatives.json");
const {buildMockWatchlistCatalog,resolveWatchlistInstrument}=require("../lib/watchlist-instrument-resolver");

test("private watchlist resolver reuses the one canonical MOCK catalog",()=>{
 const catalog=buildMockWatchlistCatalog(market,derivatives);
 assert.equal(catalog.size,20);
 assert.equal(catalog.get("MOCK|NSE|EQ|0001").trading_symbol,"MOCKALPHA");
 assert.equal(catalog.get("MOCK|NSE|INDEX|0003").segment,"NSE_INDEX");
 assert.equal([...catalog.values()].filter(x=>x.instrument_type==="FUTURE").length,4);
 assert.equal([...catalog.values()].filter(x=>x.instrument_type==="OPTION").length,12);
});
test("rejects non-MOCK, malformed and duplicate fixture identities",()=>{
 assert.throws(()=>buildMockWatchlistCatalog({...market,mode:"LIVE"},derivatives),/INVALID_CANONICAL/);
 const duplicate={...derivatives,data:{...derivatives.data,contracts:[...derivatives.data.contracts,{...derivatives.data.contracts[0]}]}};
 assert.throws(()=>buildMockWatchlistCatalog(market,duplicate),/INVALID_OR_DUPLICATE/);
});
test("official instruments remain supported and unknown keys fail closed",()=>{
 const catalog=buildMockWatchlistCatalog(market,derivatives);
 const official={instrument_key:"NSE_EQ|123",trading_symbol:"REAL"};
 assert.equal(resolveWatchlistInstrument("NSE_EQ|123",[official],catalog),official);
 assert.equal(resolveWatchlistInstrument("MOCK|NSE|EQ|0001",[],catalog).trading_symbol,"MOCKALPHA");
 assert.equal(resolveWatchlistInstrument("MOCK|NSE|EQ|9999",[],catalog),null);
});
