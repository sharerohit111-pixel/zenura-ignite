"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const source=fs.readFileSync(path.join(__dirname,"stocks.js"),"utf8");
const start=source.indexOf("async function loadInstruments()");
const end=source.indexOf("\n  }",start);
assert.notEqual(start,-1,"loadInstruments must exist");
assert.notEqual(end,-1,"loadInstruments must have a closing block");
const body=source.slice(start,end);

test("instrument master request requires a signed-in connector identity",()=>{
 assert.match(body,/connector=window\.ZENURA_MARKET_CONNECTOR/);
 assert.match(body,/connector\?\.getIdToken/);
 assert.match(body,/if\(!connector\?\.getIdToken\|\|!uid\)/);
});

test("instrument master request sends the authenticated bearer token",()=>{
 assert.match(body,/const token=await connector\.getIdToken\(\)/);
 assert.match(body,/Authorization:'Bearer '\+token/);
});

test("instrument response is discarded when the active account changes",()=>{
 assert.match(body,/connector\.getUserId\(\)!==uid/);
});
