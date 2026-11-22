"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"../..");
const html=fs.readFileSync(path.join(root,"crypto/index.html"),"utf8");
const cloud=fs.readFileSync(path.join(root,"crypto/supabase-cloud.js"),"utf8");

test("Crypto Terminal inline application script parses",()=>{
 const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
   .map(match=>match[1]).filter(source=>source.trim());
 assert.ok(scripts.length>0,"expected an inline Crypto Terminal application script");
 assert.doesNotThrow(()=>new Function(scripts[scripts.length-1]));
});

test("Crypto Terminal exposes one Market/LIMIT selector and limit-price input",()=>{
 assert.equal((html.match(/id="orderType"/g)||[]).length,1);
 assert.match(html,/option value="MARKET"/);
 assert.match(html,/option value="LIMIT"/);
 assert.match(html,/id="limitPrice"/);
});

test("Signed-in Crypto Terminal routes LIMIT placement and cancellation through cloud API",()=>{
 assert.match(cloud,/api\("\/crypto\/limit-orders"/);
 assert.match(cloud,/placeLimitOrder/);
 assert.match(cloud,/cancelLimitOrder/);
 assert.match(html,/ZENURA_CRYPTO_TRADING\.placeLimitOrder/);
 assert.match(html,/ZENURA_CRYPTO_TRADING\.cancelLimitOrder/);
 assert.match(html,/Cloud LIMIT orders require a signed-in account/);
});
