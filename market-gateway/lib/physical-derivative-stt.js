"use strict";

const { roundPaiseToNearestRupee } = require("./statutory-rounding");

const RATE_VERSION = "2018-07-26";
const VERIFIED_THROUGH = "2026-11-27";
const PHYSICAL_DELIVERY_RATE = Object.freeze({ numerator: 10, denominator: 10_000 }); // 0.10%

function required(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(label + " is required.");
  }
  return value.trim();
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function roundRatioHalfUp(numerator, denominator) {
  const q = numerator / denominator;
  const r = numerator % denominator;
  const result = q + (r * 2n >= denominator ? 1n : 0n);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Physical-delivery STT exceeds supported safe integer range.");
  }
  return Number(result);
}

// Separate settlement leg: 0.10% on settlement value for both receiver and giver.
// Do not combine this with option-exercise STT on intrinsic value.
function aggregatePhysicalDerivativeStt(events) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array.");
  const groups = new Map();
  const ids = new Set();

  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new TypeError("Each physical settlement event must be an object.");
    }
    const eventId = required(event.eventId, "eventId");
    if (ids.has(eventId)) throw new TypeError("Duplicate eventId in physical STT batch.");
    ids.add(eventId);

    const clientId = required(event.clientId, "clientId");
    const contractId = required(event.contractId, "contractId").toUpperCase();
    const settlementDate = required(event.settlementDate, "settlementDate");
    if (!validDate(settlementDate) || settlementDate < RATE_VERSION || settlementDate > VERIFIED_THROUGH) {
      throw new RangeError("No verified physical-delivery STT schedule for this settlement date.");
    }
    const side = required(event.side, "side").toUpperCase();
    if (!["BUY", "SELL"].includes(side)) throw new TypeError("side must be BUY or SELL.");
    if (!Number.isSafeInteger(event.quantity) || event.quantity <= 0) {
      throw new TypeError("quantity must be a positive safe integer.");
    }
    if (!Number.isSafeInteger(event.settlementPricePaise) || event.settlementPricePaise <= 0) {
      throw new TypeError("settlementPricePaise must be a positive safe integer.");
    }

    const key = JSON.stringify([clientId, contractId, settlementDate, side]);
    if (!groups.has(key)) {
      groups.set(key, {
        clientId, contractId, settlementDate, side,
        quantity: 0n,
        settlementValuePaise: 0n,
        eventCount: 0
      });
    }
    const group = groups.get(key);
    group.quantity += BigInt(event.quantity);
    group.settlementValuePaise += BigInt(event.quantity) * BigInt(event.settlementPricePaise);
    group.eventCount += 1;
  }

  const rows = [];
  const clientTotals = new Map();
  for (const g of groups.values()) {
    if (g.quantity > BigInt(Number.MAX_SAFE_INTEGER) ||
        g.settlementValuePaise > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError("Physical settlement aggregate exceeds supported safe integer range.");
    }
    const settlementValuePaise = Number(g.settlementValuePaise);
    const sttPaise = roundRatioHalfUp(
      BigInt(settlementValuePaise) * BigInt(PHYSICAL_DELIVERY_RATE.numerator),
      BigInt(PHYSICAL_DELIVERY_RATE.denominator)
    );
    rows.push(Object.freeze({
      clientId: g.clientId,
      contractId: g.contractId,
      settlementDate: g.settlementDate,
      side: g.side,
      payableBy: g.side === "BUY" ? "PURCHASER_RECEIVER" : "SELLER_GIVER",
      quantity: Number(g.quantity),
      settlementValuePaise,
      sttPaise,
      rateNumerator: PHYSICAL_DELIVERY_RATE.numerator,
      rateDenominator: PHYSICAL_DELIVERY_RATE.denominator,
      rateVersion: RATE_VERSION,
      eventCount: g.eventCount
    }));
    clientTotals.set(g.clientId, (clientTotals.get(g.clientId) || 0n) + BigInt(sttPaise));
  }

  const clients = [...clientTotals.entries()].map(([clientId, total]) => {
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError("Client physical STT aggregate exceeds supported safe integer range.");
    }
    const totalPaise = Number(total);
    const payableRupees = roundPaiseToNearestRupee(totalPaise);
    return Object.freeze({
      clientId,
      totalSttPaise: totalPaise,
      payableSttRupees: payableRupees,
      roundedPayablePaise: payableRupees * 100
    });
  });

  rows.sort((a, b) =>
    a.clientId.localeCompare(b.clientId) ||
    a.contractId.localeCompare(b.contractId) ||
    a.side.localeCompare(b.side)
  );
  clients.sort((a, b) => a.clientId.localeCompare(b.clientId));
  return Object.freeze({ groups: Object.freeze(rows), clients: Object.freeze(clients) });
}

module.exports = Object.freeze({
  aggregatePhysicalDerivativeStt,
  RATE_VERSION,
  VERIFIED_THROUGH
});
