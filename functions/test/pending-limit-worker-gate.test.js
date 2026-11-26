"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {isPendingLimitWorkerEnabled}=require("../lib/pending-limit-worker-gate");

test("scheduled LIMIT worker is disabled when the opt-in flag is absent",()=>{
  assert.equal(isPendingLimitWorkerEnabled({}),false);
  assert.equal(isPendingLimitWorkerEnabled({ZENURA_ENABLE_PAPER_LIMIT_WORKER:""}),false);
});

test("scheduled LIMIT worker requires the exact explicit true value",()=>{
  for(const value of ["1","yes","TRUE","True","false"," true "])
    assert.equal(isPendingLimitWorkerEnabled({ZENURA_ENABLE_PAPER_LIMIT_WORKER:value}),false);
  assert.equal(isPendingLimitWorkerEnabled({ZENURA_ENABLE_PAPER_LIMIT_WORKER:"true"}),true);
});
