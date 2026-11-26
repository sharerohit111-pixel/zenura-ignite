"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  marketDataRightsApproval,
  assertMarketDataRightsApproved,
} = require("../lib/market-data-rights-gate");
const {
  providerPaperTradingPolicy,
  hasPaperTradingMarketDataRights,
} = require("../lib/provider-paper-trading-policy");

const validRights = {
  MARKET_DATA_RIGHTS_APPROVED: "true",
  MARKET_DATA_RIGHTS_REFERENCE: "SIGNED-PROVIDER-AGREEMENT-REF",
  MARKET_DATA_REGULATORY_APPROVED: "true",
  MARKET_DATA_REGULATORY_REFERENCE: "SIGNED-COUNSEL-CLEARANCE-REF",
};

test("live, delayed, snapshot, EOD and historical exchange prices never bypass the two approval gates", () => {
  const feedModes = [
    "live", "realtime", "snapshot", "delayed", "delayed_15m",
    "delayed_30d", "end_of_day", "historical", "educational",
    "nism_simulation_lab",
  ];
  for (const mode of feedModes) {
    const env = {
      MARKET_DATA_FEED_MODE: mode,
      MARKET_DATA_EDUCATIONAL_LAG_DAYS: "30",
      MARKET_DATA_NISM_SIMULATION_LAB: "true",
    };
    assert.equal(marketDataRightsApproval(env), null, mode);
    assert.throws(() => assertMarketDataRightsApproved(env), {
      code: "market_data_rights_not_approved",
      status: 503,
    }, mode);
  }
});

test("a 30-day educational lag or NISM label is not a substitute for provider rights and regulatory clearance", () => {
  const partial = {
    ...validRights,
    MARKET_DATA_RIGHTS_APPROVED: "false",
    MARKET_DATA_EDUCATIONAL_LAG_DAYS: "30",
    MARKET_DATA_NISM_SIMULATION_LAB: "true",
  };
  assert.equal(marketDataRightsApproval(partial), null);
  assert.throws(() => assertMarketDataRightsApproved(partial), {
    code: "market_data_rights_not_approved",
    status: 503,
  });

  const missingRegulatory = {
    ...validRights,
    MARKET_DATA_REGULATORY_APPROVED: "false",
  };
  assert.equal(marketDataRightsApproval(missingRegulatory), null);
});

test("synthetic labels cannot turn an exchange/provider source into an approved source", () => {
  for (const sourceType of ["synthetic", "simulated", "paper", "mock"]) {
    const env = {
      ...validRights,
      MARKET_DATA_SOURCE_TYPE: sourceType,
      MARKET_DATA_PROVIDER: "upstox",
      MARKET_DATA_FEED_MODE: sourceType,
      MARKET_DATA_RIGHTS_APPROVED: "false",
    };
    assert.equal(marketDataRightsApproval(env), null, sourceType);
  }
});

test("prohibited and unreviewed provider policies stay denied even with complete-looking entitlement claims", () => {
  const entitlement = {
    approved: true,
    paperTradingAllowed: true,
    redistributionAllowed: true,
    reference: "account-entitlement",
    rightsApprovalReference: "signed-rights",
    regulatoryApprovalReference: "counsel-clearance",
  };
  for (const id of ["kite", "dhan", "fyers", "unknown-provider"]) {
    assert.notEqual(providerPaperTradingPolicy(id).status, "approval_required");
    assert.equal(hasPaperTradingMarketDataRights(id, entitlement), false);
  }
});

test("conditionally eligible providers require every independent documentary entitlement", () => {
  for (const id of ["upstox", "angelone", "vendor-authorized-example"]) {
    assert.equal(hasPaperTradingMarketDataRights(id, {
      approved: true,
      paperTradingAllowed: true,
      redistributionAllowed: true,
      reference: "account-entitlement",
      rightsApprovalReference: "signed-rights",
      regulatoryApprovalReference: "counsel-clearance",
    }), true);

    for (const key of [
      "approved",
      "paperTradingAllowed",
      "redistributionAllowed",
      "reference",
      "rightsApprovalReference",
      "regulatoryApprovalReference",
    ]) {
      const incomplete = {
        approved: true,
        paperTradingAllowed: true,
        redistributionAllowed: true,
        reference: "account-entitlement",
        rightsApprovalReference: "signed-rights",
        regulatoryApprovalReference: "counsel-clearance",
      };
      delete incomplete[key];
      assert.equal(hasPaperTradingMarketDataRights(id, incomplete), false, id + ":" + key);
    }
  }
});

test("a complete rights gate accepts only explicit true flags and non-empty bounded references", () => {
  assert.deepEqual(marketDataRightsApproval(validRights), {
    rightsReference: validRights.MARKET_DATA_RIGHTS_REFERENCE,
    regulatoryReference: validRights.MARKET_DATA_REGULATORY_REFERENCE,
  });
  for (const [key, value] of [
    ["MARKET_DATA_RIGHTS_APPROVED", "TRUE"],
    ["MARKET_DATA_RIGHTS_REFERENCE", " "],
    ["MARKET_DATA_RIGHTS_REFERENCE", "x".repeat(301)],
    ["MARKET_DATA_REGULATORY_APPROVED", "1"],
    ["MARKET_DATA_REGULATORY_REFERENCE", ""],
    ["MARKET_DATA_REGULATORY_REFERENCE", "x".repeat(301)],
  ]) {
    const env = { ...validRights, [key]: value };
    assert.equal(marketDataRightsApproval(env), null, key);
  }
});
