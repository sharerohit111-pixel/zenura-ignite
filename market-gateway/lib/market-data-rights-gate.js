"use strict";

function marketDataRightsApproval(env = process.env) {
  if (!env || typeof env !== "object") return null;
  if (env.MARKET_DATA_RIGHTS_APPROVED !== "true") return null;
  const reference = env.MARKET_DATA_RIGHTS_REFERENCE;
  if (typeof reference !== "string" || !reference.trim() || reference.trim().length > 300) return null;
  return reference.trim();
}

function assertMarketDataRightsApproved(env = process.env) {
  const reference = marketDataRightsApproval(env);
  if (!reference) {
    throw Object.assign(
      new Error("Live market data is disabled until written paper-trading and redistribution rights are approved."),
      { status: 503, code: "market_data_rights_not_approved" }
    );
  }
  return reference;
}

module.exports = { marketDataRightsApproval, assertMarketDataRightsApproved };
