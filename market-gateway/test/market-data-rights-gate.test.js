"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  marketDataRightsApproval,
  assertMarketDataRightsApproved,
} = require("../lib/market-data-rights-gate");

const complete = {
  MARKET_DATA_RIGHTS_APPROVED: "true",
  MARKET_DATA_RIGHTS_REFERENCE: "signed-provider-rights-record",
  MARKET_DATA_REGULATORY_APPROVED: "true",
  MARKET_DATA_REGULATORY_REFERENCE: "signed-counsel-clearance-record",
};

test("market-data gate requires both independent approvals and references", () => {
  assert.deepEqual(marketDataRightsApproval(complete), {
    rightsReference: complete.MARKET_DATA_RIGHTS_REFERENCE,
    regulatoryReference: complete.MARKET_DATA_REGULATORY_REFERENCE,
  });
  for (const patch of [
    { MARKET_DATA_RIGHTS_APPROVED: "false" },
    { MARKET_DATA_RIGHTS_REFERENCE: "" },
    { MARKET_DATA_REGULATORY_APPROVED: "false" },
    { MARKET_DATA_REGULATORY_REFERENCE: "" },
    { MARKET_DATA_RIGHTS_APPROVED: "TRUE" },
    { MARKET_DATA_REGULATORY_APPROVED: "1" },
  ]) {
    assert.equal(marketDataRightsApproval({ ...complete, ...patch }), null);
    assert.throws(() => assertMarketDataRightsApproved({ ...complete, ...patch }), {
      status: 503,
      code: "market_data_rights_not_approved",
    });
  }
});

test("approval references are bounded and whitespace-only values are rejected", () => {
  for (const patch of [
    { MARKET_DATA_RIGHTS_REFERENCE: " ".repeat(2) },
    { MARKET_DATA_RIGHTS_REFERENCE: "x".repeat(301) },
    { MARKET_DATA_REGULATORY_REFERENCE: " ".repeat(2) },
    { MARKET_DATA_REGULATORY_REFERENCE: "x".repeat(301) },
  ]) {
    assert.equal(marketDataRightsApproval({ ...complete, ...patch }), null);
  }
});

test("market-data gate is independent of feed labels and synthetic flags", () => {
  for (const mode of ["live", "delayed", "delayed_30d", "eod", "historical", "synthetic", "nism_simulation_lab"]) {
    assert.equal(marketDataRightsApproval({
      ...complete,
      MARKET_DATA_FEED_MODE: mode,
      MARKET_DATA_SOURCE_TYPE: mode,
    }) !== null, true);
    assert.equal(marketDataRightsApproval({
      ...complete,
      MARKET_DATA_RIGHTS_APPROVED: "false",
      MARKET_DATA_FEED_MODE: mode,
      MARKET_DATA_SOURCE_TYPE: mode,
    }), null);
  }
});
