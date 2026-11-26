"use strict";

const { assertMarketDataProvider, normalizeMarketDataSnapshot } = require("./market-data-provider-contract");
const { hasPaperTradingMarketDataRights } = require("./provider-paper-trading-policy");
const { assertMarketDataRightsApproved } = require("./market-data-rights-gate");

const CAPABILITIES = Object.freeze(["quote", "candles", "depth", "instrumentMaster", "stream"]);
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_CANDLES = 5000;
const MAX_INSTRUMENTS = 200000;
const MAX_DEPTH_LEVELS = 30;
const MAX_INSTRUMENT_MASTER_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

function validateCommonResult(result, { providerId, instrumentId, exchange, entitlementReference }) {
  if (!result || typeof result !== "object" || Array.isArray(result) ||
      result.providerId !== providerId || result.instrumentId !== instrumentId ||
      result.exchange !== exchange || result.entitlementReference !== entitlementReference ||
      !result.attribution || typeof result.attribution.displayName !== "string" ||
      !result.attribution.displayName.trim()) {
    fail("Provider returned incomplete or incorrectly attributed market data.", "invalid_market_data", 409);
  }
}

function validateDepthResult(result, nowMs, maxAgeMs) {
  const levelsValid = (levels, side) => Array.isArray(levels) && levels.length > 0 &&
    levels.length <= MAX_DEPTH_LEVELS && levels.every((level, index) => {
      if (!level || !Number.isSafeInteger(level.pricePaise) || level.pricePaise <= 0 ||
          !Number.isSafeInteger(level.quantity) || level.quantity <= 0) return false;
      if (index === 0) return true;
      return side === "bid"
        ? levels[index - 1].pricePaise > level.pricePaise
        : levels[index - 1].pricePaise < level.pricePaise;
    });
  if (!Number.isSafeInteger(result.timestampMs) || result.timestampMs <= 0 ||
      result.timestampMs > nowMs || nowMs - result.timestampMs > maxAgeMs ||
      typeof result.sourceSequence !== "string" || !result.sourceSequence.trim() ||
      !levelsValid(result.bids, "bid") || !levelsValid(result.asks, "ask") ||
      result.bids[0].pricePaise >= result.asks[0].pricePaise) {
    fail("Market depth is stale, incomplete, unordered or crossed.", "invalid_market_data", 409);
  }
}

function validateCandlesResult(result, nowMs) {
  if (!Array.isArray(result.candles) || result.candles.length === 0 ||
      result.candles.length > MAX_CANDLES) {
    fail("Candle response is empty or exceeds the supported bound.", "invalid_market_data", 409);
  }
  let previous = 0;
  for (const candle of result.candles) {
    if (!candle || !Number.isSafeInteger(candle.timestampMs) ||
        candle.timestampMs <= previous || candle.timestampMs > nowMs ||
        !["openPaise", "highPaise", "lowPaise", "closePaise"].every(key =>
          Number.isSafeInteger(candle[key]) && candle[key] > 0) ||
        !Number.isSafeInteger(candle.volume) || candle.volume < 0 ||
        candle.highPaise < Math.max(candle.openPaise, candle.closePaise, candle.lowPaise) ||
        candle.lowPaise > Math.min(candle.openPaise, candle.closePaise, candle.highPaise)) {
      fail("Candle data contains invalid OHLC, volume or timestamp values.", "invalid_market_data", 409);
    }
    previous = candle.timestampMs;
  }
}

function validateInstrumentMasterResult(result, nowMs) {
  if (!Number.isSafeInteger(result.generatedAtMs) || result.generatedAtMs <= 0 ||
      result.generatedAtMs > nowMs || nowMs - result.generatedAtMs > MAX_INSTRUMENT_MASTER_AGE_MS ||
      typeof result.sourceReference !== "string" || !result.sourceReference.trim() ||
      !Array.isArray(result.instruments) || result.instruments.length === 0 ||
      result.instruments.length > MAX_INSTRUMENTS) {
    fail("Instrument master is missing, stale, unprovenanced or outside safe bounds.", "invalid_market_data", 409);
  }
  const seen = new Set();
  for (const item of result.instruments) {
    if (!item || typeof item.instrumentId !== "string" || !item.instrumentId.trim() ||
        !["NSE", "BSE"].includes(item.exchange) || seen.has(item.instrumentId)) {
      fail("Instrument master contains invalid or duplicate instrument identities.", "invalid_market_data", 409);
    }
    seen.add(item.instrumentId);
  }
}

function validateStreamResult(result) {
  const stream = result.stream;
  if (!stream || typeof stream.close !== "function" ||
      (typeof stream.subscribe !== "function" && typeof stream[Symbol.asyncIterator] !== "function")) {
    fail("Provider stream handle is incomplete or cannot be safely closed.", "invalid_market_data", 409);
  }
}

class MarketDataProviderRouter {
  constructor({ providers, plan, entitlementResolver, rightsGate = assertMarketDataRightsApproved, healthRegistry = null, rateLimiter = null, clock = () => Date.now(), maxQuoteAgeMs = 15000 }) {
    if (!(providers instanceof Map) || typeof entitlementResolver !== "function" || typeof rightsGate !== "function" ||
        (healthRegistry !== null && (typeof healthRegistry.isAvailable !== "function" ||
          typeof healthRegistry.recordSuccess !== "function" || typeof healthRegistry.recordFailure !== "function")) ||
        (rateLimiter !== null && typeof rateLimiter.consume !== "function") ||
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
    this.rightsGate = rightsGate;
    this.healthRegistry = healthRegistry;
    this.rateLimiter = rateLimiter;
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
    // The generic router must independently enforce both global documentary
    // approvals; caller-supplied entitlement fields are not a substitute.
    this.rightsGate();
    const nowMs = this.clock();

    for (const providerId of this.plan[capability]) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      let entitlement;
      try {
        entitlement = await this.entitlementResolver({
          userId, providerId, capability, instrumentId, exchange,
        });
      } catch {
        continue;
      }
      if (!hasPaperTradingMarketDataRights(providerId, entitlement)) continue;

      // Shared PostgreSQL quota is consumed before any upstream call. A missing
      // policy or unavailable quota service never falls back to an in-memory limit.
      if (this.rateLimiter) {
        try {
          await this.rateLimiter.consume(providerId, capability, { userId });
        } catch {
          continue;
        }
      }

      if (this.healthRegistry && !this.healthRegistry.isAvailable(providerId)) continue;

      let health;
      try {
        health = await provider.getHealth();
      } catch {
        this.healthRegistry?.recordFailure(providerId, "health_check_failed");
        continue;
      }
      if (!health || health.healthy !== true) {
        this.healthRegistry?.recordFailure(providerId, "provider_unhealthy");
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
        let accepted;
        if (capability === "quote") {
          accepted = normalizeMarketDataSnapshot(result, {
            expectedProviderId: providerId,
            expectedInstrumentId: instrumentId,
            nowMs,
            maxAgeMs: maxAgeMs ?? this.maxQuoteAgeMs,
          });
          if (accepted.exchange !== exchange) fail("Quote exchange does not match the request.", "instrument_mismatch", 409);
        } else {
          validateCommonResult(result, {
            providerId, instrumentId, exchange, entitlementReference: entitlement.reference,
          });
          if (capability === "depth") validateDepthResult(result, nowMs, maxAgeMs ?? this.maxQuoteAgeMs);
          if (capability === "candles") validateCandlesResult(result, nowMs);
          if (capability === "instrumentMaster") validateInstrumentMasterResult(result, nowMs);
          if (capability === "stream") validateStreamResult(result);
          accepted = Object.freeze({ ...result, attribution: Object.freeze({ ...result.attribution }) });
        }
        this.healthRegistry?.recordSuccess(providerId);
        return accepted;
      } catch (error) {
        this.healthRegistry?.recordFailure(providerId, error?.code || "provider_request_failed");
        if (!isTransientProviderFailure(error) && error?.code !== "stale_market_data" &&
            error?.code !== "invalid_market_data" && error?.code !== "instrument_mismatch") throw error;
      }
    }
    fail("No authorized, healthy provider returned acceptable market data. Request rejected.", "market_data_unavailable", 503);
  }
}

module.exports = {
  CAPABILITIES,
  TRANSIENT_STATUSES,
  MAX_CANDLES,
  MAX_INSTRUMENTS,
  MAX_DEPTH_LEVELS,
  validateProviderPlan,
  isTransientProviderFailure,
  validateCommonResult,
  validateDepthResult,
  validateCandlesResult,
  validateInstrumentMasterResult,
  validateStreamResult,
  MarketDataProviderRouter,
};
