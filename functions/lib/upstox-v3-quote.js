"use strict";

function parseUpstoxV3Quote(payload, instrumentKey, nowMs = Date.now()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      payload.status !== "success" || typeof instrumentKey !== "string" ||
      !instrumentKey || !Number.isSafeInteger(nowMs) || nowMs < 1 ||
      !payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) {
    throw new Error("Invalid Upstox V3 quote response.");
  }

  const entry = Object.values(payload.data).find(
    value => value && typeof value === "object" && value.instrument_token === instrumentKey
  );
  if (!entry) throw new Error("Requested instrument is missing from Upstox quote response.");

  const price = entry.last_price;
  const timestampRaw = entry.last_trade_time;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 ||
      !(typeof timestampRaw === "string" || typeof timestampRaw === "number") ||
      !/^\d{1,16}$/.test(String(timestampRaw))) {
    throw new Error("Upstox quote price or trade timestamp is invalid.");
  }

  const timestampMs = Number(timestampRaw);
  const pricePaise = Math.round(price * 100);
  const ageMs = nowMs - timestampMs;
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 1 ||
      !Number.isSafeInteger(pricePaise) || pricePaise < 1 ||
      ageMs < 0 || ageMs > 15000) {
    throw new Error("Upstox quote is stale, future-dated, or outside safe price limits.");
  }
  return { pricePaise, timestampMs };
}

module.exports = { parseUpstoxV3Quote };
