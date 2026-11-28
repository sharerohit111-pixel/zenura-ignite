"use strict";

const BROKER_CATALOG = Object.freeze([
  Object.freeze({
    id: "upstox",
    name: "Upstox",
    adapter: "upstox",
    authFlow: "oauth",
    accountOpeningUrl: "https://upstox.com/",
    apiPricing: "reported_free",
    marketDataMode: "user_owned_connection",
    liveFeedEnabledByDefault: false,
    requiresPerUserToken: true,
  }),
  Object.freeze({
    id: "fyers",
    name: "FYERS",
    adapter: "fyers",
    authFlow: "oauth_v3",
    accountOpeningUrl: "https://fyers.in/",
    apiPricing: "reported_free",
    marketDataMode: "user_owned_connection",
    liveFeedEnabledByDefault: false,
    requiresPerUserToken: true,
  }),
  Object.freeze({
    id: "angel_one",
    name: "Angel One",
    adapter: "angel_one",
    authFlow: "smartapi",
    accountOpeningUrl: "https://www.angelone.in/",
    apiPricing: "reported_free",
    marketDataMode: "user_owned_connection",
    liveFeedEnabledByDefault: false,
    requiresPerUserToken: true,
  }),
]);

const EXCLUDED_BROKERS = Object.freeze(["dhan", "zerodha"]);

function normalizeReferralUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Referral URL must be an absolute HTTPS URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new TypeError("Referral URL must use HTTPS.");
  }
  return parsed.toString();
}

function getBrokerCatalog({ referralUrls = {} } = {}) {
  const referrals = referralUrls && typeof referralUrls === "object" ? referralUrls : {};
  return BROKER_CATALOG.map((broker) => Object.freeze({
    ...broker,
    referralUrl: normalizeReferralUrl(referrals[broker.id]),
    accountOpeningLinkType: normalizeReferralUrl(referrals[broker.id])
      ? "affiliate"
      : "official",
  }));
}

function getBrokerById(id, options) {
  return getBrokerCatalog(options).find((broker) => broker.id === id) || null;
}

module.exports = {
  BROKER_CATALOG,
  EXCLUDED_BROKERS,
  getBrokerCatalog,
  getBrokerById,
};
