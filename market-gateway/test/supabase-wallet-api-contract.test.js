"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"..","supabase-server.js"),"utf8");
function route(start,end){const i=source.indexOf(start);assert.notEqual(i,-1);const j=source.indexOf(end,i);assert.notEqual(j,-1);return source.slice(i,j);}
test("account API exposes available and blocked cash with both reservation buckets",()=>{
 const r=route('app.get("/paper/account"', 'function watchlistName');
 assert.match(r,/availablePaperCash\(data\)/);
 assert.match(r,/availableCashPaise,blockedCashPaise/);
 assert.match(r,/reservedCashPaise:data\.reserved_cash_paise/);
 assert.match(r,/reservedMarginPaise:data\.reserved_margin_paise/);
});
test("equity portfolio exposes available cash and sellable quantity after close reservations",()=>{
 const r=route('app.get("/paper/portfolio"', 'app.post("/paper/derivative/margin-preview"');
 assert.match(r,/availablePaperCash\(account\)/);
 assert.match(r,/reservedQuantity:p\.reserved_quantity\?\?0/);
 assert.match(r,/reservedQuantity=source\?\.reservedQuantity\?\?0/);
 assert.match(r,/sellableQuantity:position\.quantity-reservedQuantity/);
 assert.match(r,/reservedCashPaise:account\.reserved_cash_paise/);
});
test("Options and Futures portfolio APIs expose the same wallet availability contract",()=>{
 const o=route('app.get("/paper/derivatives/portfolio"', 'app.post("/paper/futures/orders"');
 const f=route('app.get("/paper/futures/portfolio"', 'app.post("/stream"');
 for(const r of [o,f]){
  assert.match(r,/availablePaperCash\(account\)/);
  assert.match(r,/availableCashPaise,blockedCashPaise/);
  assert.match(r,/reservedCashPaise:account\.reserved_cash_paise/);
  assert.match(r,/reservedMarginPaise:account\.reserved_margin_paise/);
 }
});
