"use strict";

// Deterministic Futures risk arithmetic for PAPER simulation only.
// This module does not fetch, quote, or claim NSE/SPAN/broker margin.
const BASIS_POINTS = 10000;

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(name + " must be a positive safe integer.");
  return value;
}
function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(name + " must be a non-negative safe integer.");
  return value;
}
function safeNumber(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(name + " exceeds safe integer range.");
  return n;
}
function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}
function signedPnl(quantity, fromPricePaise, toPricePaise) {
  if (!Number.isSafeInteger(quantity) || quantity === 0) throw new TypeError("quantity must be a non-zero safe integer.");
  positiveInteger(fromPricePaise, "fromPricePaise");
  positiveInteger(toPricePaise, "toPricePaise");
  return safeNumber(BigInt(quantity) * (BigInt(toPricePaise) - BigInt(fromPricePaise)), "P&L");
}

/**
 * Calculate an explicitly configured simulation margin requirement.
 * Rates are scenario inputs in basis points, not exchange rates.
 */
function calculateSimulatedMargin({ pricePaise, quantity, initialMarginBps, maintenanceMarginBps }) {
  positiveInteger(pricePaise, "pricePaise");
  positiveInteger(quantity, "quantity");
  positiveInteger(initialMarginBps, "initialMarginBps");
  positiveInteger(maintenanceMarginBps, "maintenanceMarginBps");
  if (initialMarginBps > BASIS_POINTS || maintenanceMarginBps > initialMarginBps) {
    throw new RangeError("Margin rates must satisfy 0 < maintenance <= initial <= 10000 bps.");
  }
  const notional = BigInt(pricePaise) * BigInt(quantity);
  const initial = ceilDiv(notional * BigInt(initialMarginBps), BigInt(BASIS_POINTS));
  const maintenance = ceilDiv(notional * BigInt(maintenanceMarginBps), BigInt(BASIS_POINTS));
  return {
    notionalPaise: safeNumber(notional, "notionalPaise"),
    initialMarginPaise: safeNumber(initial, "initialMarginPaise"),
    maintenanceMarginPaise: safeNumber(maintenance, "maintenanceMarginPaise"),
    effectiveLeverageBps: safeNumber(ceilDiv(notional * BigInt(BASIS_POINTS), initial), "effectiveLeverageBps"),
    marginModel: "CONFIGURABLE_SIMULATION",
    exchangeMarginClaim: false,
    simulationOnly: true
  };
}

/** Account-level margin snapshot; usedMargin includes filled + pending reservations supplied by caller. */
function calculateMarginAvailability({ cashPaise, reservedCashPaise = 0, usedMarginPaise }) {
  nonNegativeInteger(cashPaise, "cashPaise");
  nonNegativeInteger(reservedCashPaise, "reservedCashPaise");
  nonNegativeInteger(usedMarginPaise, "usedMarginPaise");
  const totalReserved = BigInt(reservedCashPaise) + BigInt(usedMarginPaise);
  const available = BigInt(cashPaise) - totalReserved;
  return {
    cashPaise,
    reservedCashPaise,
    usedMarginPaise,
    totalReservedPaise: safeNumber(totalReserved, "totalReservedPaise"),
    availableMarginPaise: safeNumber(available, "availableMarginPaise"),
    insufficientMargin: available < 0n,
    simulationOnly: true
  };
}

function calculateUnrealizedPnl({ netQuantity, averagePricePaise, markPricePaise }) {
  return { unrealizedPnlPaise: signedPnl(netQuantity, averagePricePaise, markPricePaise), simulationOnly: true };
}

/** Daily variation margin against the last accepted settlement basis. */
function calculateDailySettlement({ netQuantity, previousSettlementPricePaise, settlementPricePaise, nextMarkPricePaise }) {
  const variation = signedPnl(netQuantity, previousSettlementPricePaise, settlementPricePaise);
  const postSettlementUnrealized = nextMarkPricePaise == null
    ? null
    : signedPnl(netQuantity, settlementPricePaise, positiveInteger(nextMarkPricePaise, "nextMarkPricePaise"));
  return {
    variationMarginPaise: variation,
    nextSettlementBasisPaise: settlementPricePaise,
    postSettlementUnrealizedPnlPaise: postSettlementUnrealized,
    settlementMode: "SIMULATED_DAILY_VARIATION",
    simulationOnly: true
  };
}

/** Isolated-position risk check. It signals a breach; it never places a liquidation order. */
function evaluateMaintenanceRisk({ reservedMarginPaise, unrealizedPnlPaise, maintenanceMarginPaise }) {
  nonNegativeInteger(reservedMarginPaise, "reservedMarginPaise");
  nonNegativeInteger(maintenanceMarginPaise, "maintenanceMarginPaise");
  if (!Number.isSafeInteger(unrealizedPnlPaise)) throw new TypeError("unrealizedPnlPaise must be a safe integer.");
  const equity = BigInt(reservedMarginPaise) + BigInt(unrealizedPnlPaise);
  const maintenance = BigInt(maintenanceMarginPaise);
  const deficit = maintenance - equity;
  return {
    marginEquityPaise: safeNumber(equity, "marginEquityPaise"),
    maintenanceMarginPaise,
    maintenanceDeficitPaise: safeNumber(deficit > 0n ? deficit : 0n, "maintenanceDeficitPaise"),
    liquidationRequired: equity <= maintenance,
    riskModel: "ISOLATED_SIMULATION",
    simulationOnly: true,
    executesLiquidation: false
  };
}

/** Expiry close requires an explicit settlement price and provenance; no LTP/payoff fallback. */
function settleExpiredPosition({ netQuantity, averagePricePaise, reservedMarginPaise, settlementPricePaise, settlementSource, expiryReached }) {
  if (expiryReached !== true) throw new Error("Contract expiry has not been reached.");
  if (typeof settlementSource !== "string" || !settlementSource.trim()) throw new Error("Settlement price provenance is required.");
  positiveInteger(settlementPricePaise, "settlementPricePaise");
  nonNegativeInteger(reservedMarginPaise, "reservedMarginPaise");
  const realized = signedPnl(netQuantity, averagePricePaise, settlementPricePaise);
  return {
    realizedPnlPaise: realized,
    releasedMarginPaise: reservedMarginPaise,
    remainingQuantity: 0,
    settlementPricePaise,
    settlementSource: settlementSource.trim(),
    settlementMode: "EXPLICIT_SIMULATED_EXPIRY_SETTLEMENT",
    simulationOnly: true
  };
}

module.exports = {
  calculateSimulatedMargin,
  calculateMarginAvailability,
  calculateUnrealizedPnl,
  calculateDailySettlement,
  evaluateMaintenanceRisk,
  settleExpiredPosition
};
