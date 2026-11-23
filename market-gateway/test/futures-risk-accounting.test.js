"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const risk = require("../lib/futures-risk-accounting");

test("simulated initial/maintenance margin and leverage use explicit scenario basis points", () => {
  const result = risk.calculateSimulatedMargin({
    pricePaise: 100000, quantity: 25, initialMarginBps: 1200, maintenanceMarginBps: 800
  });
  assert.equal(result.notionalPaise, 2500000);
  assert.equal(result.initialMarginPaise, 300000);
  assert.equal(result.maintenanceMarginPaise, 200000);
  assert.equal(result.effectiveLeverageBps, 83334);
  assert.equal(result.marginModel, "CONFIGURABLE_SIMULATION");
  assert.equal(result.exchangeMarginClaim, false);
});

test("margin availability subtracts both cash reservations and used margin", () => {
  const result = risk.calculateMarginAvailability({
    cashPaise: 1000000, reservedCashPaise: 100000, usedMarginPaise: 350000
  });
  assert.equal(result.availableMarginPaise, 550000);
  assert.equal(result.insufficientMargin, false);
});

test("insufficient margin is explicit and is not silently clamped to zero", () => {
  const result = risk.calculateMarginAvailability({
    cashPaise: 100000, reservedCashPaise: 25000, usedMarginPaise: 90000
  });
  assert.equal(result.availableMarginPaise, -15000);
  assert.equal(result.insufficientMargin, true);
});

test("unrealized P&L handles long and short positions", () => {
  assert.equal(risk.calculateUnrealizedPnl({netQuantity: 25, averagePricePaise: 10000, markPricePaise: 11000}).unrealizedPnlPaise, 25000);
  assert.equal(risk.calculateUnrealizedPnl({netQuantity: -25, averagePricePaise: 10000, markPricePaise: 11000}).unrealizedPnlPaise, -25000);
});

test("daily settlement books variation from prior settlement and resets mark basis", () => {
  const result = risk.calculateDailySettlement({
    netQuantity: -25, previousSettlementPricePaise: 10000,
    settlementPricePaise: 9800, nextMarkPricePaise: 9900
  });
  assert.equal(result.variationMarginPaise, 5000);
  assert.equal(result.nextSettlementBasisPaise, 9800);
  assert.equal(result.postSettlementUnrealizedPnlPaise, -2500);
  assert.equal(result.settlementMode, "SIMULATED_DAILY_VARIATION");
});

test("maintenance risk signals liquidation threshold but never executes it", () => {
  const result = risk.evaluateMaintenanceRisk({
    reservedMarginPaise: 20000, unrealizedPnlPaise: -15000, maintenanceMarginPaise: 6000
  });
  assert.equal(result.marginEquityPaise, 5000);
  assert.equal(result.maintenanceDeficitPaise, 1000);
  assert.equal(result.liquidationRequired, true);
  assert.equal(result.executesLiquidation, false);
});

test("expiry settlement requires expiry and explicit settlement provenance", () => {
  assert.throws(() => risk.settleExpiredPosition({
    netQuantity: 10, averagePricePaise: 10000, reservedMarginPaise: 5000,
    settlementPricePaise: 11000, settlementSource: "scenario", expiryReached: false
  }), /expiry has not been reached/);
  assert.throws(() => risk.settleExpiredPosition({
    netQuantity: 10, averagePricePaise: 10000, reservedMarginPaise: 5000,
    settlementPricePaise: 11000, settlementSource: "", expiryReached: true
  }), /provenance is required/);
  const result = risk.settleExpiredPosition({
    netQuantity: -10, averagePricePaise: 10000, reservedMarginPaise: 5000,
    settlementPricePaise: 9000, settlementSource: "simulation scenario #1", expiryReached: true
  });
  assert.equal(result.realizedPnlPaise, 10000);
  assert.equal(result.releasedMarginPaise, 5000);
  assert.equal(result.remainingQuantity, 0);
  assert.equal(result.simulationOnly, true);
});

test("rejects invalid rates, zero quantity, and unsafe money arithmetic", () => {
  assert.throws(() => risk.calculateSimulatedMargin({
    pricePaise: 1000, quantity: 1, initialMarginBps: 10001, maintenanceMarginBps: 5000
  }), /Margin rates/);
  assert.throws(() => risk.calculateUnrealizedPnl({
    netQuantity: 0, averagePricePaise: 1000, markPricePaise: 1000
  }), /non-zero/);
  assert.throws(() => risk.calculateSimulatedMargin({
    pricePaise: Number.MAX_SAFE_INTEGER, quantity: 2, initialMarginBps: 1000, maintenanceMarginBps: 500
  }), /safe integer range/);
});
