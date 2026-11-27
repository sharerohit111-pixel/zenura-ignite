"use strict";

// Broker-specific DP aggregation for paper estimates.
// Upstox publishes DP charges per scrip per day on delivery sells.
// This utility is intentionally separate from order execution until the
// caller can supply authoritative client + ISIN + trade-date identity.

const DEFAULT_DP_CHARGE_PAISE = 2000;

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(label + " is required.");
  }
  return value.trim();
}

function assertChargePaise(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("dpChargePaise must be a non-negative safe integer.");
  }
}

function aggregateDpChargesByScripDay(sellExecutions, { dpChargePaise = DEFAULT_DP_CHARGE_PAISE } = {}) {
  if (!Array.isArray(sellExecutions)) {
    throw new TypeError("sellExecutions must be an array.");
  }
  assertChargePaise(dpChargePaise);

  const grouped = new Map();
  for (const execution of sellExecutions) {
    if (!execution || typeof execution !== "object" || Array.isArray(execution)) {
      throw new TypeError("Each sell execution must be an object.");
    }
    const accountId = requiredString(execution.accountId, "accountId");
    const isin = requiredString(execution.isin, "isin").toUpperCase();
    const tradeDate = requiredString(execution.tradeDate, "tradeDate");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) ||
        new Date(tradeDate + "T00:00:00.000Z").toISOString().slice(0, 10) !== tradeDate) {
      throw new TypeError("tradeDate must be a valid YYYY-MM-DD date.");
    }
    if (execution.side !== "SELL" || execution.segment !== "EQUITY_DELIVERY") {
      throw new TypeError("DP aggregation accepts delivery SELL executions only.");
    }
    const key = JSON.stringify([accountId, isin, tradeDate]);
    if (!grouped.has(key)) {
      grouped.set(key, { accountId, isin, tradeDate, executionCount: 0, dpChargePaise });
    }
    grouped.get(key).executionCount += 1;
  }

  return Object.freeze([...grouped.values()].map(row => Object.freeze({ ...row })));
}

module.exports = Object.freeze({
  DEFAULT_DP_CHARGE_PAISE,
  aggregateDpChargesByScripDay
});
