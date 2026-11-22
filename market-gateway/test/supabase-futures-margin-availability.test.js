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
