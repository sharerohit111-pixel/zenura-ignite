"use strict";

const REQUIRED_MARKET_DATA_METHODS = Object.freeze([
  "getQuote",
  "getCandles",
  "getDepth",
  "getInstrumentMaster",
  "openStream",
  "getHealth",
]);

function assertProviderId(providerId) {
  if (typeof providerId !== "string" || !/^[a-z][a-z0-9_-]{1,39}$/.test(providerId)) {
    throw new TypeError("Market-data provider id is invalid.");
  }
}

function assertMarketDataProvider(provider) {
  if (!provider || typeof provider !== "object") {
    throw new TypeError("Market-data provider is required.");
  }
  assertProviderId(provider.providerId);
  for (const method of REQUIRED_MARKET_DATA_METHODS) {
    if (typeof provider[method] !== "function") {
      throw new TypeError("Market-data provider is missing " + method + "().");
    }
  }
  return provider;
}

function normalizeMarketDataSnapshot(input, {
  expectedProviderId,
  expectedInstrumentId,
  nowMs = Date.now(),
  maxAgeMs = 15000,
} = {}) {
  const fail = (message, code = "invalid_market_data") => {
    throw Object.assign(new Error(message), { status: 409, code });
  };
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Market-data snapshot is missing.");
  if (typeof expectedProviderId !== "string" || input.providerId !== expectedProviderId) {
    fail("Market-data provider attribution does not match the selected provider.");
  }
  if (typeof expectedInstrumentId !== "string" || input.instrumentId !== expectedInstrumentId) {
    fail("Market-data instrument identity does not match the requested instrument.");
  }
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0 ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) {
    fail("Market-data freshness policy is invalid.");
  }
  const receivedAtMs = input.receivedAtMs;
  const exchangeTimestampMs = input.exchangeTimestampMs;
  const lastTradeTimestampMs = input.lastTradeTimestampMs;
  const lastPricePaise = input.lastPricePaise;
  if (!Number.isSafeInteger(receivedAtMs) || receivedAtMs <= 0 ||
      receivedAtMs > nowMs || nowMs - receivedAtMs > maxAgeMs) {
    fail("Market-data receipt timestamp is missing, future-dated or stale.", "stale_market_data");
  }
  if (!Number.isSafeInteger(exchangeTimestampMs) || exchangeTimestampMs <= 0 ||
      exchangeTimestampMs > nowMs || nowMs - exchangeTimestampMs > maxAgeMs) {
    fail("Exchange snapshot timestamp is missing, future-dated or stale.", "stale_market_data");
  }
  if (!Number.isSafeInteger(lastTradeTimestampMs) || lastTradeTimestampMs <= 0 ||
      lastTradeTimestampMs > nowMs) {
    fail("Last-trade timestamp is missing or invalid.");
  }
  if (!Number.isSafeInteger(lastPricePaise) || lastPricePaise <= 0) {
    fail("Last-traded price must be a positive integer paise value.");
  }
  if (typeof input.exchange !== "string" || !["NSE", "BSE"].includes(input.exchange)) {
    fail("Market-data exchange is unsupported.");
  }
  if (typeof input.sourceSequence !== "string" || !input.sourceSequence.trim()) {
    fail("Provider source sequence / event identity is required.");
  }
  if (typeof input.entitlementReference !== "string" || !input.entitlementReference.trim()) {
    fail("A verified data-entitlement reference is required.");
  }
  if (!input.attribution || typeof input.attribution !== "object" ||
      typeof input.attribution.displayName !== "string" ||
      !input.attribution.displayName.trim()) {
    fail("Market-data source attribution is required.");
  }
  return Object.freeze({
    providerId: input.providerId,
    instrumentId: input.instrumentId,
    exchange: input.exchange,
    lastPricePaise,
    receivedAtMs,
    exchangeTimestampMs,
    lastTradeTimestampMs,
    sourceSequence: input.sourceSequence,
    entitlementReference: input.entitlementReference,
    attribution: Object.freeze({ ...input.attribution }),
  });
}

module.exports = {
  REQUIRED_MARKET_DATA_METHODS,
  assertMarketDataProvider,
  normalizeMarketDataSnapshot,
};
