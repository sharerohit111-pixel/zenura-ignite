"use strict";

const { normalizeUpstoxNseFuturesMaster } = require("./nse-futures-instrument-master");

function fail(message) {
  throw Object.assign(new Error(message), { status: 409 });
}

function parseSnapshotTimestamp(value) {
  if (typeof value !== "string" || !/T.*(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)) return null;
  const timestampMs = Date.parse(value);
  return Number.isSafeInteger(timestampMs) && timestampMs > 0 ? timestampMs : null;
}

function toPricePaise(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const paise = Math.round(value * 100);
  return Number.isSafeInteger(paise) && paise > 0 && Math.abs(value * 100 - paise) < 1e-7
    ? paise : null;
}

function normalizeDepthSide(levels, side, tickSizePaise) {
  if (!Array.isArray(levels) || levels.length === 0 || levels.length > 20) {
    fail("Upstox Futures depth side is missing or exceeds the supported 20-level limit.");
  }
  const normalized = [];
  let previousPrice = null;
  for (const level of levels) {
    if (!level || typeof level !== "object" || Array.isArray(level)) {
      fail("Upstox Futures depth contains a malformed level.");
    }
    const pricePaise = toPricePaise(level.price);
    const quantity = level.quantity;
    if (pricePaise === null || pricePaise % tickSizePaise !== 0
        || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) {
      fail("Upstox Futures depth contains an invalid price, tick or quantity.");
    }
    if (previousPrice !== null
        && (side === "ASK" ? pricePaise < previousPrice : pricePaise > previousPrice)) {
      fail("Upstox Futures depth levels are not in executable price order.");
    }
    normalized.push(Object.freeze({ pricePaise, quantity }));
    previousPrice = pricePaise;
  }
  return Object.freeze(normalized);
}

/**
 * Provider-specific Upstox V3 adapter. It only converts provider data into a
 * canonical snapshot. It never submits broker orders or writes accounting.
 */
function createUpstoxFuturesMarketDataAdapter() {
  return Object.freeze({
    providerId: "UPSTOX",
    async normalizeInstrumentMaster(rows, options = {}) {
      return normalizeUpstoxNseFuturesMaster(rows, options);
    },
    normalizeDepthSnapshot(payload, {
      instrumentKey,
      tickSizePaise,
      nowMs = Date.now(),
      maxAgeMs = 15000
    } = {}) {
      if (!payload || typeof payload !== "object" || payload.status !== "success"
          || !payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)
          || typeof instrumentKey !== "string" || !instrumentKey
          || !Number.isSafeInteger(tickSizePaise) || tickSizePaise < 1
          || !Number.isSafeInteger(nowMs) || nowMs < 1
          || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1) {
        fail("Invalid Upstox Futures depth snapshot request.");
      }
      const entry = Object.values(payload.data).find(item =>
        item && typeof item === "object" && item.instrument_token === instrumentKey
      );
      if (!entry) fail("Upstox Futures depth response does not contain the requested instrument.");

      const timestampMs = parseSnapshotTimestamp(entry.timestamp);
      if (timestampMs === null || timestampMs > nowMs || nowMs - timestampMs > maxAgeMs) {
        fail("Upstox Futures depth snapshot is missing, future-dated or stale.");
      }
      if (!entry.depth || typeof entry.depth !== "object") {
        fail("Upstox Futures depth is unavailable; LTP fallback is disabled.");
      }

      const bids = normalizeDepthSide(entry.depth.buy, "BID", tickSizePaise);
      const asks = normalizeDepthSide(entry.depth.sell, "ASK", tickSizePaise);
      if (bids[0].pricePaise > asks[0].pricePaise) {
        fail("Upstox Futures depth is crossed.");
      }
      return Object.freeze({
        providerId: "UPSTOX",
        instrumentKey,
        timestampMs,
        ageMs: nowMs - timestampMs,
        bids,
        asks
      });
    }
  });
}

module.exports = { createUpstoxFuturesMarketDataAdapter };
