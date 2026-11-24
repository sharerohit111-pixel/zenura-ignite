"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  providerPaperTradingPolicy,
  hasPaperTradingMarketDataRights,
} = require("../lib/provider-paper-trading-policy");

test("blocks providers whose published terms/support prohibit live-data paper trading", () => {
  for (const id of ["kite", "dhan", "fyers"]) {
    assert.equal(providerPaperTradingPolicy(id).status, "prohibited");
    assert.equal(hasPaperTradingMarketDataRights(id, {
      approved: true, paperTradingAllowed: true, redistributionAllowed: true,
      reference: "entitlement", rightsApprovalReference: "written-approval",
    }), false);
  }
});

test("requires both entitlement and separate written use-case rights for conditional providers", () => {
  for (const id of ["upstox", "angelone", "vendor-authorized-example"]) {
    assert.equal(hasPaperTradingMarketDataRights(id, {
      approved: true, paperTradingAllowed: true, redistributionAllowed: true,
      reference: "account-entitlement", rightsApprovalReference: "provider-contract-2026-01",
    }), true);
    for (const missing of [
      { approved: false, paperTradingAllowed: true, redistributionAllowed: true, reference: "e", rightsApprovalReference: "r" },
      { approved: true, paperTradingAllowed: false, redistributionAllowed: true, reference: "e", rightsApprovalReference: "r" },
      { approved: true, paperTradingAllowed: true, redistributionAllowed: false, reference: "e", rightsApprovalReference: "r" },
      { approved: true, paperTradingAllowed: true, redistributionAllowed: true, reference: "e" },
      { approved: true, paperTradingAllowed: true, redistributionAllowed: true, rightsApprovalReference: "r" },
    ]) assert.equal(hasPaperTradingMarketDataRights(id, missing), false);
  }
});

test("fails closed for unreviewed provider ids", () => {
  assert.equal(providerPaperTradingPolicy("unknown-feed").status, "unreviewed");
  assert.equal(hasPaperTradingMarketDataRights("unknown-feed", {
    approved: true, paperTradingAllowed: true, redistributionAllowed: true,
    reference: "e", rightsApprovalReference: "r",
  }), false);
});
