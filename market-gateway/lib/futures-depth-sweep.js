"use strict";

const { createHash } = require("node:crypto");

// Pure, feature-inert NSE Futures depth sweep.
// This module does not fetch quotes or write orders/accounting state.
function reject(message) {
  throw Object.assign(new Error(message), { status: 409 });
}

function safePositive(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) reject(name + " must be a positive safe integer.");
}

function safeResult(value, name) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    reject(name + " exceeds supported safe-integer bounds.");
  }
  return Number(value);
}

function validateLevels(levels, side, tickSizePaise) {
  if (!Array.isArray(levels) || levels.length === 0) reject("A complete two-sided Futures depth snapshot is required.");
  let previous = null;
  return levels.map((level, index) => {
    if (!level || typeof level !== "object" || Array.isArray(level)) reject("Malformed " + side + " depth level.");
    const pricePaise = level.pricePaise;
    const quantity = level.quantity;
    safePositive(pricePaise, side + " level price");
    safePositive(quantity, side + " level quantity");
    if (pricePaise % tickSizePaise !== 0) reject("A Futures depth level is off the contract tick size.");
    if (previous !== null) {
      const ordered = side === "asks" ? pricePaise > previous : pricePaise < previous;
      if (!ordered) reject("Futures " + side + " levels must be strictly price ordered without duplicate levels.");
    }
    previous = pricePaise;
    return Object.freeze({ pricePaise, quantity, levelIndex: index });
  });
}

/**
 * Sweep one immutable provider snapshot. BUY consumes asks ascending; SELL
 * consumes bids descending. Insufficient total depth rejects the entire order.
 *
 * VWAP is rounded half-up to the nearest paise for display. The exact
 * numerator and quantity are also returned as decimal strings/integers.
 */
function resolveFuturesDepthSweep({
  quote, expectedInstrumentKey, side, quantity, tickSizePaise,
  nowMs = Date.now(), maxAgeMs = 15000
} = {}) {
  if (!quote || typeof quote !== "object" || Array.isArray(quote)
      || typeof expectedInstrumentKey !== "string" || !expectedInstrumentKey.trim()
      || quote.instrumentKey !== expectedInstrumentKey
      || !["BUY", "SELL"].includes(side)
      || !Number.isSafeInteger(quantity) || quantity < 1
      || !Number.isSafeInteger(tickSizePaise) || tickSizePaise < 1
      || !Number.isSafeInteger(nowMs) || nowMs < 1
      || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1) {
    reject("Invalid NSE Futures depth-sweep request or instrument identity.");
  }

  const timestampMs = quote.timestampMs;
  const ageMs = nowMs - timestampMs;
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 1 || ageMs < 0 || ageMs > maxAgeMs) {
    reject("A fresh, non-future NSE Futures depth snapshot is required.");
  }

  const bids = validateLevels(quote.bids, "bids", tickSizePaise);
  const asks = validateLevels(quote.asks, "asks", tickSizePaise);
  if (bids[0].pricePaise > asks[0].pricePaise) {
    reject("The NSE Futures order book is crossed; MARKET execution was rejected.");
  }

  const canonicalSnapshot = JSON.stringify({
    instrumentKey: expectedInstrumentKey,
    timestampMs,
    bids: bids.map(({ pricePaise, quantity }) => [pricePaise, quantity]),
    asks: asks.map(({ pricePaise, quantity }) => [pricePaise, quantity])
  });
  const snapshotHash = createHash("sha256").update(canonicalSnapshot).digest("hex");

  const levels = side === "BUY" ? asks : bids;
  let remaining = quantity;
  let notionalPaise = 0n;
  const fills = [];

  for (const level of levels) {
    if (remaining === 0) break;
    const fillQuantity = Math.min(remaining, level.quantity);
    if (fillQuantity > 0) {
      notionalPaise += BigInt(level.pricePaise) * BigInt(fillQuantity);
      fills.push(Object.freeze({
        levelIndex: level.levelIndex,
        pricePaise: level.pricePaise,
        quantity: fillQuantity,
        grossPaise: safeResult(BigInt(level.pricePaise) * BigInt(fillQuantity), "Level turnover")
      }));
      remaining -= fillQuantity;
    }
  }

  if (remaining !== 0) {
    reject("Displayed NSE Futures depth is insufficient to fully simulate this MARKET order.");
  }

  const grossPaise = safeResult(notionalPaise, "Aggregate turnover");
  const denominator = BigInt(quantity);
  const roundedVwap = (notionalPaise * 2n + denominator) / (2n * denominator);
  return Object.freeze({
    instrumentKey: expectedInstrumentKey,
    side,
    quantity,
    fills: Object.freeze(fills),
    grossPaise,
    vwapPaise: safeResult(roundedVwap, "VWAP"),
    vwapNumeratorPaiseQty: notionalPaise.toString(),
    vwapDenominatorQuantity: quantity,
    quoteTimestampMs: timestampMs,
    snapshotHash,
    quoteAgeMs: ageMs,
    executionPolicy: side === "BUY" ? "SWEEP_ASKS_LOW_TO_HIGH" : "SWEEP_BIDS_HIGH_TO_LOW",
    partialFillAllowed: false,
    simulationOnly: true
  });
}

module.exports = { resolveFuturesDepthSweep };
