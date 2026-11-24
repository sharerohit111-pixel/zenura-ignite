"use strict";

const REQUIRED_BROKER_EXECUTION_METHODS = Object.freeze([
  "placeOrder",
  "cancelOrder",
  "getOrder",
  "getOrderBook",
  "getHealth",
]);

function assertBrokerExecutionProvider(provider) {
  if (!provider || typeof provider !== "object" ||
      typeof provider.providerId !== "string" ||
      !/^[a-z][a-z0-9_-]{1,39}$/.test(provider.providerId)) {
    throw new TypeError("Broker execution provider identity is invalid.");
  }
  for (const method of REQUIRED_BROKER_EXECUTION_METHODS) {
    if (typeof provider[method] !== "function") {
      throw new TypeError("Broker execution provider is missing " + method + "().");
    }
  }
  return provider;
}

function assertLiveExecutionExplicitlyAuthorized({
  liveExecutionEnabled = false,
  ownerApprovalReference = null,
  brokerEntitlementReference = null,
  environment = "test",
} = {}) {
  if (environment !== "production" || liveExecutionEnabled !== true ||
      typeof ownerApprovalReference !== "string" || !ownerApprovalReference.trim() ||
      typeof brokerEntitlementReference !== "string" || !brokerEntitlementReference.trim()) {
    throw Object.assign(
      new Error("Live broker execution is disabled: production, owner approval and broker entitlement are all required."),
      { status: 403, code: "live_execution_not_authorized" }
    );
  }
  return true;
}

module.exports = {
  REQUIRED_BROKER_EXECUTION_METHODS,
  assertBrokerExecutionProvider,
  assertLiveExecutionExplicitlyAuthorized,
};
