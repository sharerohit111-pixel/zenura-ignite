"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { marketDataRightsApproval, assertMarketDataRightsApproved } = require("../lib/market-data-rights-gate");

test("fails closed when approval flag or written reference is missing", () => {
  for (const env of [
    {},
    { MARKET_DATA_RIGHTS_APPROVED: "false", MARKET_DATA_RIGHTS_REFERENCE: "contract" },
    { MARKET_DATA_RIGHTS_APPROVED: "true" },
    { MARKET_DATA_RIGHTS_APPROVED: "true", MARKET_DATA_RIGHTS_REFERENCE: " " },
    { MARKET_DATA_RIGHTS_APPROVED: "true", MARKET_DATA_RIGHTS_REFERENCE: "x".repeat(301) },
    null,
  ]) {
    assert.equal(marketDataRightsApproval(env), null);
    assert.throws(() => assertMarketDataRightsApproved(env), { code: "market_data_rights_not_approved", status: 503 });
  }
});

test("accepts only explicit approval with a bounded written reference", () => {
  const env = { MARKET_DATA_RIGHTS_APPROVED: "true", MARKET_DATA_RIGHTS_REFERENCE: "UPSTOX-LEGAL-APPROVAL-2026-001" };
  assert.equal(marketDataRightsApproval(env), env.MARKET_DATA_RIGHTS_REFERENCE);
  assert.equal(assertMarketDataRightsApproved(env), env.MARKET_DATA_RIGHTS_REFERENCE);
});
