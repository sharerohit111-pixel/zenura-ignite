"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {availablePaperCash}=require("../lib/available-paper-cash");

test("available paper cash subtracts pending LIMIT cash and futures margin reservations",()=>{
  assert.equal(availablePaperCash({cash_paise:10000000,reserved_cash_paise:1250000,reserved_margin_paise:2750000}),6000000);
});
test("available paper cash is zero when all cash is reserved",()=>{
  assert.equal(availablePaperCash({cash_paise:1000,reserved_cash_paise:400,reserved_margin_paise:600}),0);
});
test("available paper cash rejects missing, negative, fractional and unsafe account values",()=>{
  for(const account of [
    null,
    {cash_paise:1000,reserved_cash_paise:0},
    {cash_paise:-1,reserved_cash_paise:0,reserved_margin_paise:0},
    {cash_paise:1000,reserved_cash_paise:1.5,reserved_margin_paise:0},
    {cash_paise:Number.MAX_SAFE_INTEGER+1,reserved_cash_paise:0,reserved_margin_paise:0},
    {cash_paise:1000,reserved_cash_paise:700,reserved_margin_paise:400}
  ])assert.throws(()=>availablePaperCash(account));
});
