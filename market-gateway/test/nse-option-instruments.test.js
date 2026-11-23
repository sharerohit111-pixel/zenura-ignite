"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {isNseOptionContract,filterNseOptionContracts}=require("../lib/nse-option-instruments");

const contracts=[
  {instrument_key:"NSE|CE",exchange:"NSE",segment:"NSE_FO",instrument_type:"CE"},
  {instrument_key:"NSE|PE",exchange:"NSE",segment:"NSE_FO",instrument_type:"PE"},
  {instrument_key:"BSE|CE",exchange:"BSE",segment:"BSE_FO",instrument_type:"CE"},
  {instrument_key:"BSE|PE",exchange:"BSE",segment:"BSE_FO",instrument_type:"PE"},
  {instrument_key:"NSE|FUT",exchange:"NSE",segment:"NSE_FO",instrument_type:"FUT"},
  {instrument_key:"NSE|EQ",exchange:"NSE",segment:"NSE_EQ",instrument_type:"EQ"}
];

test("only verified NSE_FO CE and PE contracts are options",()=>{
  assert.equal(isNseOptionContract(contracts[0]),true);
  assert.equal(isNseOptionContract(contracts[1]),true);
  for(const item of contracts.slice(2))assert.equal(isNseOptionContract(item),false);
});

test("option instrument discovery excludes BSE options and non-options",()=>{
  assert.deepEqual(filterNseOptionContracts(contracts).map(x=>x.instrument_key),["NSE|CE","NSE|PE"]);
  assert.deepEqual(filterNseOptionContracts(null),[]);
  assert.deepEqual(filterNseOptionContracts({}),[]);
});
