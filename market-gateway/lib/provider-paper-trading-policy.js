"use strict";

// Provider API availability is not permission to use exchange data in a public
// paper-trading simulator. These decisions are deliberately fail-closed.
const PROVIDER_PAPER_TRADING_POLICY = Object.freeze({
  upstox: Object.freeze({ status: "approval_required", reason: "Written provider and exchange rights for this exact paper-trading use case are not verified." }),
  angelone: Object.freeze({ status: "approval_required", reason: "Written provider and exchange rights for this exact paper-trading use case are not verified." }),
  kite: Object.freeze({ status: "prohibited", reason: "Kite Connect terms expressly prohibit using its APIs/live market data for virtual or mock trading apps." }),
  dhan: Object.freeze({ status: "prohibited", reason: "Dhan support states paper trading with virtual funds and live market data is not supported." }),
  fyers: Object.freeze({ status: "prohibited", reason: "FYERS API terms prohibit using exchange data for paper trading, gaming, and virtual trading." }),
  licensed_vendor: Object.freeze({ status: "approval_required", reason: "A current contract must expressly grant display, simulator use, user scope, and redistribution rights." }),
});

function providerPaperTradingPolicy(providerId) {
  if (typeof providerId !== "string" || !/^[a-z][a-z0-9_-]{1,39}$/.test(providerId)) {
    throw new TypeError("Market-data provider id is invalid.");
  }
  return PROVIDER_PAPER_TRADING_POLICY[providerId] ||
    (providerId.startsWith("vendor-") ? PROVIDER_PAPER_TRADING_POLICY.licensed_vendor :
      Object.freeze({ status: "unreviewed", reason: "Provider-specific API terms and market-data rights have not been reviewed." }));
}

function hasPaperTradingMarketDataRights(providerId, entitlement) {
  const policy = providerPaperTradingPolicy(providerId);
  if (policy.status !== "approval_required" || !entitlement || typeof entitlement !== "object") return false;
  return entitlement.approved === true &&
    entitlement.paperTradingAllowed === true &&
    entitlement.displayAllowed === true &&
    entitlement.redistributionAllowed === true &&
    typeof entitlement.reference === "string" && entitlement.reference.trim().length > 0 &&
    typeof entitlement.rightsApprovalReference === "string" && entitlement.rightsApprovalReference.trim().length > 0 &&
    typeof entitlement.regulatoryApprovalReference === "string" && entitlement.regulatoryApprovalReference.trim().length > 0;
}

module.exports = { PROVIDER_PAPER_TRADING_POLICY, providerPaperTradingPolicy, hasPaperTradingMarketDataRights };
