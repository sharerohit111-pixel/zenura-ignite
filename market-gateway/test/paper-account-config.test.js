"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {DEFAULT_PAPER_STARTING_CASH_PAISE,paperStartingCashPaise}=require("../lib/paper-account-config");

test("new Indian paper accounts default to ₹10 lakh when no override is configured",()=>{
 assert.equal(DEFAULT_PAPER_STARTING_CASH_PAISE,100000000);
 assert.equal(paperStartingCashPaise({}),100000000);
 assert.equal(paperStartingCashPaise({INDIAN_PAPER_STARTING_CASH_PAISE:""}),100000000);
});

test("administrator can configure a positive whole-paise starting balance",()=>{
 assert.equal(paperStartingCashPaise({INDIAN_PAPER_STARTING_CASH_PAISE:"25000000"}),25000000);
});

test("invalid explicit starting-balance configuration fails closed",()=>{
 for(const value of ["0","-1","1.5","1e8","NaN","Infinity","9007199254740992"," 1000","1000 "])
  assert.equal(paperStartingCashPaise({INDIAN_PAPER_STARTING_CASH_PAISE:value}),null,value);
});

test("missing environment object uses the safe default",()=>{
 assert.equal(paperStartingCashPaise(undefined),100000000);
});
