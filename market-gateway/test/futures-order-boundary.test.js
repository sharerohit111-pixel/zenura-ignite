"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const server=fs.readFileSync(path.join(__dirname,"../supabase-server.js"),"utf8");
const start=server.indexOf('app.post("/paper/futures/orders"');
const end=server.indexOf('app.post("/paper/futures/orders/:orderId/cancel"',start);
const route=server.slice(start,end);

test("Futures MARKET and LIMIT execution accept only NSE_FO contracts",()=>{
  assert.ok(start>=0&&end>start,"dedicated Futures order route must exist");
  assert.match(route,/instrument\.exchange==="NSE"&&instrument\.segment==="NSE_FO"/);
  assert.doesNotMatch(route,/\["NSE_FO","BSE_FO"\]\.includes\(x\.segment\)/);
  assert.match(route,/Futures LIMIT currently supports NSE contracts only/);
});
