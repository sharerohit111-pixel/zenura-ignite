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
      approved: true, paperTradingAllowed: true, redistributionAllowed: true, displayAllowed: true,
      reference: "entitlement", rightsApprovalReference: "written-approval", regulatoryApprovalReference: "counsel-approval",
    }), false);
  }
});

test("requires explicit display, redistribution and separate written use-case rights for conditional providers", () => {
  for (const id of ["upstox", "angelone", "vendor-authorized-example"]) {
    assert.equal(hasPaperTradingMarketDataRights(id, {
      approved: true, paperTradingAllowed: true, redistributionAllowed: true, displayAllowed: true,
      reference: "account-entitlement", rightsApprovalReference: "provider-contract-2026-01", regulatoryApprovalReference: "counsel-approval-2026-01",
    }), true);
    for (const missing of [
      { approved: true, paperTradingAllowed: true, redistributionAllowed: true, reference: "e", rightsApprovalReference: "r", regulatoryApprovalReference: "counsel" },
      { approved: false, paperTradingAllowed: true, redistributionAllowed: true, displayAllowed: true, reference: "e", rightsApprovalReference: "r", regulatoryApprovalReference: "counsel" },
      { approved: true, paperTradingAllowed: false, redistributionAllowed: true, displayAllowed: true, reference: "e", rightsApprovalReference: "r", regulatoryApprovalReference: "counsel" },
      { approved: true, paperTradingAllowed: true, redistributionAllowed: false, displayAllowed: true, reference: "e", rightsApprovalReference: "r", regulatoryApprovalReference: "counsel" },
      { approved: true, paperTradingAllowed: true, redistributionAllowed: true, displayAllowed: true, reference: "e" },
      { approved: true, paperTradingAllowed: true, redistributionAllowed: true, displayAllowed: true, rightsApprovalReference: "r", regulatoryApprovalReference: "counsel" },
    ]) assert.equal(hasPaperTradingMarketDataRights(id, missing), false);
  }
});

test("fails closed for unreviewed provider ids", () => {
  assert.equal(providerPaperTradingPolicy("unknown-feed").status, "unreviewed");
  assert.equal(hasPaperTradingMarketDataRights("unknown-feed", {
    approved: true, paperTradingAllowed: true, redistributionAllowed: true, displayAllowed: true,
    reference: "e", rightsApprovalReference: "r", regulatoryApprovalReference: "counsel",
  }), false);
});
