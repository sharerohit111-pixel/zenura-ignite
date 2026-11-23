"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const server=fs.readFileSync(path.join(__dirname,"../supabase-server.js"),"utf8");

test("Supabase futures margin preview compares broker margin against unreserved cash",()=>{
  assert.match(server,/require\("\.\/lib\/available-paper-cash"\)/);
  assert.match(server,/select\("cash_paise,reserved_cash_paise,reserved_margin_paise"\)/);
  assert.match(server,/const availableCashPaise=availablePaperCash\(account\)/);
  assert.match(server,/availableVirtualCashPaise:availableCashPaise/);
  assert.match(server,/shortfallPaise:Math\.max\(margin\.requiredMarginPaise-availableCashPaise,0\)/);
  assert.doesNotMatch(server,/availableVirtualCashPaise:account\.cash_paise/);
});


test("Futures idempotent MARKET replay returns the original fill before requiring a live provider quote",()=>{
  const replayLookup=server.indexOf('from("paper_futures_orders").select("*").eq("user_id",user.id).eq("idempotency_key",idempotencyKey)');
  const replayReturn=server.indexOf("idempotentReplay:true,simulationOnly:true",replayLookup);
  const providerQuote=server.indexOf("getUpstoxAccessToken(user.id)",replayLookup);
  assert.ok(replayLookup>=0,"futures idempotency lookup must exist");
  assert.ok(replayReturn>replayLookup,"stored fill must be returned on replay");
  assert.ok(providerQuote>replayReturn,"provider token/quote must only be required for a new order");
  assert.match(server,/validateDerivativeContract,normalizeTickSizePaise/);
  assert.match(server,/pricePaise:normalizeTickSizePaise\(instrument\.tick_size\)/);
});


test("Long-option idempotent replay returns the original fill before requiring a live provider quote",()=>{
  const replayLookup=server.indexOf('from("paper_derivative_orders").select("*").eq("user_id",user.id).eq("idempotency_key",idempotencyKey)');
  const replayReturn=server.indexOf("idempotentReplay:true,simulationOnly:true,excludesCharges:false",replayLookup);
  const providerQuote=server.indexOf("getUpstoxAccessToken(user.id)",replayLookup);
  assert.ok(replayLookup>=0,"option idempotency lookup must exist");
  assert.ok(replayReturn>replayLookup,"stored option fill must be returned on replay");
  assert.ok(providerQuote>replayReturn,"provider token/quote must only be required for a new option order");
  assert.match(server,/pricePaise:normalizeTickSizePaise\(instrument\.tick_size\)/);
});
