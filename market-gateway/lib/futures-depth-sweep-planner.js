"use strict";

function fail(message) {
  throw Object.assign(new Error(message), { status: 409 });
}

/**
 * Pure paper-execution planner. Produces individual depth-level fill legs but
 * does not reserve funds, persist fills, charge fees, or settle accounting.
 * Insufficient aggregate displayed depth rejects the entire plan.
 */
function planFuturesDepthSweep({ snapshot, side, quantity, tickSizePaise } = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
      || !["BUY", "SELL"].includes(side)
      || !Number.isSafeInteger(quantity) || quantity < 1
      || !Number.isSafeInteger(tickSizePaise) || tickSizePaise < 1
      || !Array.isArray(snapshot.bids) || !Array.isArray(snapshot.asks)) {
    fail("Invalid Futures depth-sweep planning request.");
  }

  const levels = side === "BUY" ? snapshot.asks : snapshot.bids;
  if (levels.length < 1 || levels.length > 20) {
    fail("A valid executable Futures depth side is required.");
  }

  let remaining = quantity;
  let grossPaise = 0;
  const fills = [];
  let previousPrice = null;
  for (const level of levels) {
    if (!level || typeof level !== "object" || Array.isArray(level)
        || !Number.isSafeInteger(level.pricePaise) || level.pricePaise < 1
        || level.pricePaise % tickSizePaise !== 0
        || !Number.isSafeInteger(level.quantity) || level.quantity < 1) {
      fail("Futures depth contains an invalid price or quantity.");
    }
    if (previousPrice !== null
        && (side === "BUY" ? level.pricePaise < previousPrice : level.pricePaise > previousPrice)) {
      fail("Futures depth levels are not ordered by executable price.");
    }
    previousPrice = level.pricePaise;
    if (remaining === 0) break;
    const fillQuantity = Math.min(remaining, level.quantity);
    const fillGrossPaise = fillQuantity * level.pricePaise;
    if (!Number.isSafeInteger(fillGrossPaise) || fillGrossPaise < 1
        || !Number.isSafeInteger(grossPaise + fillGrossPaise)) {
      fail("Futures depth-sweep turnover exceeds supported calculation limits.");
    }
    fills.push(Object.freeze({
      pricePaise: level.pricePaise,
      quantity: fillQuantity,
      grossPaise: fillGrossPaise
    }));
    grossPaise += fillGrossPaise;
    remaining -= fillQuantity;
  }

  if (remaining > 0) {
    fail("Insufficient displayed Futures depth; the full paper MARKET order was rejected.");
  }

  return Object.freeze({
    providerId: snapshot.providerId || null,
    instrumentKey: snapshot.instrumentKey || null,
    side,
    requestedQuantity: quantity,
    filledQuantity: quantity,
    grossPaise,
    fills: Object.freeze(fills),
    executionPolicy: side === "BUY" ? "ASK_DEPTH_ASCENDING" : "BID_DEPTH_DESCENDING",
    insufficientDepthPolicy: "REJECT_ENTIRE_ORDER",
    simulationOnly: true
  });
}

module.exports = { planFuturesDepthSweep };
