"use strict";

const { assertMarketDataProvider, normalizeMarketDataSnapshot } = require("./market-data-provider-contract");

const CAPABILITIES = Object.freeze(["quote", "candles", "depth", "instrumentMaster", "stream"]);
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function fail(message, code = "market_data_unavailable", status = 503) {
  throw Object.assign(new Error(message), { code, status });
}

function validateProviderPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new TypeError("Provider routing plan is required.");
  }
  const result = {};
  for (const capability of CAPABILITIES) {
    const ids = plan[capability];
    if (!Array.isArray(ids) || ids.length === 0 ||
        ids.some(id => typeof id !== "string" || !/^[a-z][a-z0-9_-]{1,39}$/.test(id)) ||
        new Set(ids).size !== ids.length) {
      throw new TypeError("A non-empty unique provider list is required for " + capability + ".");
    }
    result[capability] = Object.freeze([...ids]);
  }
  return Object.freeze(result);
}

function isTransientProviderFailure(error) {
  return Boolean(error && (TRANSIENT_STATUSES.has(Number(error.status)) ||
    error.code === "ETIMEDOUT" || error.code === "ECONNRESET" ||
    error.code === "EAI_AGAIN" || error.code === "provider_unavailable"));
}

class MarketDataProviderRouter {
  constructor({ providers, plan, entitlementResolver, clock = () => Date.now(), maxQuoteAgeMs = 15000 }) {
    if (!(providers instanceof Map) || typeof entitlementResolver !== "function" ||
        typeof clock !== "function" || !Number.isSafeInteger(maxQuoteAgeMs) || maxQuoteAgeMs <= 0) {
      throw new TypeError("Market-data router dependencies are invalid.");
    }
    for (const [id, provider] of providers) {
      assertMarketDataProvider(provider);
      if (id !== provider.providerId) throw new TypeError("Provider registry key does not match provider id.");
    }
    this.providers = new Map(providers);
    this.plan = validateProviderPlan(plan);
    this.entitlementResolver = entitlementResolver;
    this.clock = clock;
    this.maxQuoteAgeMs = maxQuoteAgeMs;
  }

  async route(capability, args, { userId, instrumentId, exchange, maxAgeMs } = {}) {
    if (!CAPABILITIES.includes(capability)) throw new TypeError("Unsupported market-data capability.");
    if (typeof userId !== "string" || !userId ||
        typeof instrumentId !== "string" || !instrumentId ||
        !["NSE", "BSE"].includes(exchange)) {
      fail("Authenticated user and exact exchange instrument identity are required.", "invalid_market_data_request", 400);
    }
    const method = capability === "instrumentMaster" ? "getInstrumentMaster" :
      capability === "stream" ? "openStream" :
      capability === "candles" ? "getCandles" :
      capability === "depth" ? "getDepth" : "getQuote";
    const nowMs = this.clock();
    const failures = [];

    for (const providerId of this.plan[capability]) {
      const provider = this.providers.get(providerId);
      if (!provider) {
        failures.push({ providerId, reason: "provider_not_registered" });
        continue;
      }

      let entitlement;
      try {
        entitlement = await this.entitlementResolver({
          userId, providerId, capability, instrumentId, exchange,
        });
      } catch {
        failures.push({ providerId, reason: "entitlement_lookup_failed" });
        continue;
      }
      if (!entitlement || entitlement.approved !== true ||
          typeof entitlement.reference !== "string" || !entitlement.reference.trim()) {
        failures.push({ providerId, reason: "entitlement_not_approved" });
        continue;
      }

      let health;
      try {
        health = await provider.getHealth();
      } catch {
        failures.push({ providerId, reason: "health_check_failed" });
        continue;
      }
      if (!health || health.healthy !== true) {
        failures.push({ providerId, reason: "provider_unhealthy" });
        continue;
      }

      try {
        const result = await provider[method]({
          ...args,
          userId,
          instrumentId,
          exchange,
          entitlementReference: entitlement.reference,
        });
        if (capability === "quote") {
          const snapshot = normalizeMarketDataSnapshot(result, {
            expectedProviderId: providerId,
            expectedInstrumentId: instrumentId,
            nowMs,
            maxAgeMs: maxAgeMs ?? this.maxQuoteAgeMs,
          });
          if (snapshot.exchange !== exchange) fail("Quote exchange does not match the request.", "instrument_mismatch", 409);
          return snapshot;
        }
        if (!result || typeof result !== "object" || Array.isArray(result) ||
            result.providerId !== providerId || result.instrumentId !== instrumentId ||
            result.exchange !== exchange || result.entitlementReference !== entitlement.reference ||
            !result.attribution || typeof result.attribution.displayName !== "string" ||
            !result.attribution.displayName.trim()) {
          fail("Provider returned incomplete or incorrectly attributed market data.", "invalid_market_data", 409);
        }
        return Object.freeze({ ...result, attribution: Object.freeze({ ...result.attribution }) });
      } catch (error) {
        if (!isTransientProviderFailure(error) && error?.code !== "stale_market_data" &&
            error?.code !== "invalid_market_data" && error?.code !== "instrument_mismatch") {
          throw error;
        }
        failures.push({ providerId, reason: error?.code || "provider_request_failed" });
      }
    }
    fail("No authorized, healthy provider returned acceptable market data. Request rejected.", "market_data_unavailable", 503);
  }
}

module.exports = {
  CAPABILITIES,
  TRANSIENT_STATUSES,
  validateProviderPlan,
  isTransientProviderFailure,
  MarketDataProviderRouter,
};
