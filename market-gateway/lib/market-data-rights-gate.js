"use strict";

function marketDataRightsApproval(env = process.env) {
  if (!env || typeof env !== "object") return null;
  if (env.MARKET_DATA_RIGHTS_APPROVED !== "true") return null;
  if (env.MARKET_DATA_REGULATORY_APPROVED !== "true") return null;
  const rightsReference = env.MARKET_DATA_RIGHTS_REFERENCE;
  const regulatoryReference = env.MARKET_DATA_REGULATORY_REFERENCE;
  if (typeof rightsReference !== "string" || !rightsReference.trim() || rightsReference.trim().length > 300) return null;
  if (typeof regulatoryReference !== "string" || !regulatoryReference.trim() || regulatoryReference.trim().length > 300) return null;
  return Object.freeze({ rightsReference: rightsReference.trim(), regulatoryReference: regulatoryReference.trim() });
}

function assertMarketDataRightsApproved(env = process.env) {
  const approval = marketDataRightsApproval(env);
  if (!approval) {
    throw Object.assign(
      new Error("Market data is disabled until written provider/exchange rights and separate product-level regulatory clearance are approved."),
      { status: 503, code: "market_data_rights_not_approved" }
    );
  }
  return approval;
}

module.exports = { marketDataRightsApproval, assertMarketDataRightsApproved };
