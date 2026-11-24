"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {filterAndRankInstrumentCatalog}=require("../lib/instrument-catalog");
const mock=require("../lib/mock-market-data");

const catalog=[
 {instrument_key:"NSE_EQ|TCS",exchange:"NSE",segment:"NSE_EQ",instrument_type:"EQ",trading_symbol:"TCS",name:"Tata Consultancy Services",underlying_symbol:"TCS"},
 {instrument_key:"BSE_EQ|TCS",exchange:"BSE",segment:"BSE_EQ",instrument_type:"EQ",trading_symbol:"TCS",name:"Tata Consultancy Services",underlying_symbol:"TCS"},
 {instrument_key:"NSE_INDEX|NIFTY",exchange:"NSE",segment:"NSE_INDEX",instrument_type:"INDEX",trading_symbol:"NIFTY",name:"NIFTY 50",underlying_symbol:"NIFTY"},
 {instrument_key:"NSE_FO|NIFTY-FUT",exchange:"NSE",segment:"NSE_FO",instrument_type:"FUT",trading_symbol:"NIFTY FUT",name:"NIFTY Futures",underlying_symbol:"NIFTY",expiry:"2026-12-31",lot_size:65},
 {instrument_key:"NSE_FO|NIFTY-24000-CE",exchange:"NSE",segment:"NSE_FO",instrument_type:"CE",trading_symbol:"NIFTY 24000 CE",name:"NIFTY 24000 CE",underlying_symbol:"NIFTY",expiry:"2026-12-31",strike_price:24000},
 {instrument_key:"NSE_FO|NIFTY-24000-PE",exchange:"NSE",segment:"NSE_FO",instrument_type:"PE",trading_symbol:"NIFTY 24000 PE",name:"NIFTY 24000 PE",underlying_symbol:"NIFTY",expiry:"2026-12-31",strike_price:24000}
];

test("shared catalog applies identical exchange, kind, underlying and ranked search rules",()=>{
 const result=filterAndRankInstrumentCatalog(catalog,{kind:"equities",q:"tcs"});
 assert.deepEqual(result.map(x=>x.instrument_key),["BSE_EQ|TCS","NSE_EQ|TCS"]);
 assert.equal(filterAndRankInstrumentCatalog(catalog,{kind:"equities",exchange:"NSE",q:"tcs"}).length,1);
 assert.equal(filterAndRankInstrumentCatalog(catalog,{kind:"indices",underlying:"NIFTY"}).length,1);
});

test("shared catalog applies exact expiry, option side and strike range consistently",()=>{
 const result=filterAndRankInstrumentCatalog(catalog,{kind:"options",underlying:"NIFTY",expiry:"2026-12-31",optionType:"CE",minStrike:23000,maxStrike:24500});
 assert.deepEqual(result.map(x=>x.instrument_key),["NSE_FO|NIFTY-24000-CE"]);
 assert.equal(filterAndRankInstrumentCatalog(catalog,{kind:"options",strike:25000}).length,0);
});

test("shared catalog rejects unsupported exchange, inverted strike range and unsafe limits",()=>{
 assert.throws(()=>filterAndRankInstrumentCatalog(catalog,{exchange:"MCX"}),/Exchange must be NSE or BSE/);
 assert.throws(()=>filterAndRankInstrumentCatalog(catalog,{minStrike:25000,maxStrike:24000}),/Minimum strike/);
 assert.throws(()=>filterAndRankInstrumentCatalog(catalog,{limit:101}),/Limit must be between/);
});

test("live-style and Dummy JSON catalogs share filter behavior without merging data sources",()=>{
 const dummy=mock.listInstruments({kind:"options",underlying:"NIFTY",expiry:"2026-11-26",optionType:"PE",strike:25000});
 const generic=filterAndRankInstrumentCatalog(mock.listInstruments({kind:"all",limit:100}),{kind:"options",underlying:"NIFTY",expiry:"2026-11-26",optionType:"PE",strike:25000});
 assert.deepEqual(dummy.map(x=>x.instrument_key),generic.map(x=>x.instrument_key));
 assert.ok(dummy.every(x=>x.data_class==="SYNTHETIC_FIXTURE"));
});

test("shared catalog accepts ISO dates and rejects malformed expiry/as-of filters",()=>{
 assert.equal(filterAndRankInstrumentCatalog(catalog,{kind:"futures",expiry:"2026-12-31"}).length,1);
 assert.equal(filterAndRankInstrumentCatalog(catalog,{kind:"futures",asOf:"2026-12-01"}).length,1);
 assert.throws(()=>filterAndRankInstrumentCatalog(catalog,{expiry:"2026/12/31"}),/Expiry must use YYYY-MM-DD/);
 assert.throws(()=>filterAndRankInstrumentCatalog(catalog,{asOf:"26-12-01"}),/As-of date must use YYYY-MM-DD/);
});
