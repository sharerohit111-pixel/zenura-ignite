"use strict";

function fail(message, code = "invalid_market_data") {
  throw Object.assign(new Error(message), { status: 409, code });
}
function epochMs(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function rupeesToPaise(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const paise = Math.round(n * 100);
  return Number.isSafeInteger(paise) && paise > 0 &&
    Math.abs(n * 100 - paise) < 1e-7 ? paise : null;
}
function getMapping(instrumentMap, key) {
  if (instrumentMap instanceof Map) return instrumentMap.get(key);
  if (instrumentMap && typeof instrumentMap === "object" && !Array.isArray(instrumentMap)) {
    return instrumentMap[key];
  }
  return null;
}

/**
 * Convert decoded Upstox V3 feed frames into provider-neutral quote snapshots.
 * The caller supplies a per-subscription native-key map whose entries were
 * resolved from the canonical instrument master and authorized entitlement.
 * Unknown keys and malformed/stale feed entries are dropped, never guessed.
 */
function normalizeUpstoxFeedQuotes(payload, {
  instrumentMap,
  now = Date.now(),
  maxAgeMs = 15000,
} = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("Upstox feed frame is malformed.");
  }
  if (!Number.isSafeInteger(now) || now <= 0 ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) {
    fail("Upstox feed freshness policy is invalid.");
  }
  // Upstox V3 sends market_info before the initial live snapshot. It is a
  // protocol-control frame, not a quote. Accept and ignore it at this quote
  // boundary; market status must not be mistaken for a tradable price snapshot.
  if (payload.type === "market_info") {
    if (!epochMs(payload.currentTs) || !payload.marketInfo ||
        typeof payload.marketInfo !== "object" || Array.isArray(payload.marketInfo) ||
        !payload.marketInfo.segmentStatus ||
        typeof payload.marketInfo.segmentStatus !== "object" ||
        Array.isArray(payload.marketInfo.segmentStatus)) {
      fail("Upstox market-info control frame is malformed.");
    }
    return [];
  }
  if (!payload.feeds || typeof payload.feeds !== "object" || Array.isArray(payload.feeds)) {
    fail("Upstox live-feed frame is malformed.");
  }
  const frameTimestampMs = epochMs(payload.currentTs);
  if (!frameTimestampMs || frameTimestampMs > now || now - frameTimestampMs > maxAgeMs) return [];

  const snapshots = [];
  for (const [instrumentKey, feed] of Object.entries(payload.feeds)) {
    const mapping = getMapping(instrumentMap, instrumentKey);
    if (!mapping || mapping.nativeInstrumentKey !== instrumentKey ||
        typeof mapping.instrumentId !== "string" || !mapping.instrumentId.trim() ||
        !["NSE", "BSE"].includes(mapping.exchange) ||
        typeof mapping.entitlementReference !== "string" || !mapping.entitlementReference.trim()) continue;

    const quote = feed?.ltpc || feed?.fullFeed?.marketFF?.ltpc || feed?.fullFeed?.indexFF?.ltpc;
    const lastTradeTimestampMs = epochMs(quote?.ltt);
    const lastPricePaise = rupeesToPaise(quote?.ltp);
    if (!lastTradeTimestampMs || lastTradeTimestampMs > now ||
        now - lastTradeTimestampMs > maxAgeMs || !lastPricePaise) continue;

    snapshots.push(Object.freeze({
      providerId: "upstox",
      instrumentId: mapping.instrumentId,
      exchange: mapping.exchange,
      lastPricePaise,
      receivedAtMs: now,
      exchangeTimestampMs: frameTimestampMs,
      lastTradeTimestampMs,
      sourceSequence: [instrumentKey, frameTimestampMs, lastTradeTimestampMs, lastPricePaise].join(":"),
      entitlementReference: mapping.entitlementReference,
      attribution: Object.freeze({ displayName: "Upstox" }),
    }));
  }
  return snapshots;
}

module.exports = { normalizeUpstoxFeedQuotes, rupeesToPaise };
