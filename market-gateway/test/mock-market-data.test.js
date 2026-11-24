"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const mock=require("../lib/mock-market-data");

test("demo instrument master covers NSE/BSE equities, indices and derivatives",()=>{
 const all=mock.listInstruments({kind:"all",limit:100});
 for(const kind of ["equities","indices","futures","options"])assert.ok(mock.listInstruments({kind,limit:100}).length>0,kind);
 assert.ok(all.some(x=>x.exchange==="NSE"));assert.ok(all.some(x=>x.exchange==="BSE"));
 assert.ok(all.every(x=>x.data_class==="SYNTHETIC_FIXTURE"));
});
test("search is case-insensitive, ranked and exchange-filterable",()=>{
 const rows=mock.listInstruments({kind:"equities",q:"tcs",exchange:"BSE"});
 assert.equal(rows.length,1);assert.equal(rows[0].trading_symbol,"TCS");assert.equal(rows[0].exchange,"BSE");
 assert.deepEqual(mock.listInstruments({kind:"equities",q:"not-a-stock"}),[]);
});
test("filters constrain kind, expiry, underlying, option type and strike",()=>{
 const rows=mock.listInstruments({kind:"options",underlying:"NIFTY",expiry:"2026-11-26",optionType:"CE",minStrike:24500,maxStrike:25000});
 assert.deepEqual(rows.map(x=>x.strike_price),[24500,25000]);
 assert.ok(rows.every(x=>x.instrument_type==="CE"&&x.expiry==="2026-11-26"));
});
test("expiry discovery is sorted, deterministic and excludes expired contracts",()=>{
 assert.deepEqual(mock.listExpiries({underlying:"NIFTY",kind:"options"}),["2026-11-26","2026-12-31"]);
 assert.deepEqual(mock.listExpiries({underlying:"SENSEX",exchange:"BSE",kind:"futures"}),["2026-12-01","2026-12-29"]);
 assert.deepEqual(mock.listExpiries({underlying:"NIFTY",kind:"options",asOf:"2026-11-27"}),["2026-12-31"]);
});
test("option chain exposes CE/PE pairs and exact expiry/strike selection",()=>{
 const chain=mock.getOptionChain({underlying:"NIFTY",expiry:"2026-11-26"});
 assert.equal(chain.isLive,false);assert.equal(chain.strikes.length,4);
 assert.ok(chain.strikes.every(x=>x.CE&&x.PE));
 const selected=mock.getOptionChain({underlying:"NIFTY",expiry:"2026-11-26",strike:25000,optionType:"PE"});
 assert.equal(selected.strikes.length,1);assert.equal(selected.strikes[0].PE.instrument_type,"PE");assert.equal(selected.strikes[0].CE,null);
});
test("quotes, depth and candles are deterministic and explicitly synthetic",()=>{
 const item=mock.listInstruments({kind:"equities",exchange:"NSE",limit:1})[0];
 const a=mock.getQuote(item.instrument_key),b=mock.getQuote(item.instrument_key);
 assert.deepEqual(a,b);assert.equal(a.source,"SYNTHETIC_MOCK_JSON");assert.equal(a.isLive,false);
 assert.equal(a.label,"DEMO DATA · SYNTHETIC ONLY");assert.equal(a.bids.length,5);assert.equal(a.asks.length,5);
 assert.deepEqual(mock.getCandles(item.instrument_key,{timeframe:"5m",count:12}),mock.getCandles(item.instrument_key,{timeframe:"5m",count:12}));
});
test("invalid filters and unknown instruments fail closed",()=>{
 assert.throws(()=>mock.listInstruments({kind:"crypto"}),/Unsupported instrument kind/);
 assert.throws(()=>mock.listInstruments({exchange:"MCX"}),/Exchange must be NSE or BSE/);
 assert.throws(()=>mock.listInstruments({limit:101}),/Limit must be between/);
 assert.throws(()=>mock.getQuote("NSE_EQ|UNKNOWN"),/Unknown demo instrument/);
 assert.throws(()=>mock.getOptionChain({underlying:""}),/Underlying is required/);
});
test("no provider, network or wall-clock quote generation is used",()=>{
 const meta=mock.getDemoMetadata();
 assert.equal(meta.source,"SYNTHETIC_MOCK_JSON");assert.equal(meta.isLive,false);
 assert.equal(meta.asOf,"2026-11-24T09:15:00+05:30");
 const nifty=mock.listInstruments({kind:"indices",q:"NIFTY",limit:1})[0];
 assert.equal(mock.getQuote(nifty.instrument_key).lastPricePaise,2450125);
});
