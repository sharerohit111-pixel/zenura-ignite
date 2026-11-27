"use strict";

const { roundPaiseToNearestRupee } = require("./statutory-rounding");

const SUPPORTED_FROM = "2026-04-01";
const VERIFIED_THROUGH = "2026-11-27";
const RATE_SCHEDULE = Object.freeze({
  FUTURES_SELL: Object.freeze({ numerator: 5, denominator: 10000, payableBy: "SELLER", taxableBasis: "ACTUAL_TRADE_VALUE" }),
  OPTIONS_SELL: Object.freeze({ numerator: 15, denominator: 10000, payableBy: "SELLER", taxableBasis: "OPTION_PREMIUM" }),
  OPTIONS_EXERCISE_BUY: Object.freeze({ numerator: 15, denominator: 10000, payableBy: "PURCHASER", taxableBasis: "INTRINSIC_VALUE" })
});

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(label + " is required.");
  }
  return value.trim();
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function assertPaise(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(label + " must be a non-negative safe integer.");
  }
}

function roundRatioHalfUp(numerator, denominator) {
  const q = numerator / denominator;
  const r = numerator % denominator;
  const result = q + (r * 2n >= denominator ? 1n : 0n);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("STT amount exceeds the supported safe integer range.");
  }
  return Number(result);
}

function getSttSchedule(tradeDate) {
  if (!validDate(tradeDate)) throw new TypeError("tradeDate must be a valid YYYY-MM-DD date.");
  if (tradeDate < SUPPORTED_FROM || tradeDate > VERIFIED_THROUGH) {
    throw new RangeError("No verified F&O STT rate schedule is configured for this trade date.");
  }
  return Object.freeze({
    version: "2026-04-01",
    verifiedThrough: VERIFIED_THROUGH,
    rates: RATE_SCHEDULE
  });
}

// NSE Clearing F&O methodology: identify client code, aggregate sell trades
// for each client and contract for the trading day; futures taxable value is
// actual traded value, options sell is premium, exercise is intrinsic value.
// This module models only those three cash-STT event classes. Physical delivery
// STT is intentionally rejected because it needs the delivery-settlement leg.
function aggregateDerivativeStt(events) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array.");
  const groups = new Map();
  const seenEventIds = new Set();

  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new TypeError("Each STT event must be an object.");
    }
    const eventId = requiredText(event.eventId, "eventId");
    if (seenEventIds.has(eventId)) throw new TypeError("Duplicate eventId in STT batch.");
    seenEventIds.add(eventId);

    const clientId = requiredText(event.clientId, "clientId");
    const contractId = requiredText(event.contractId, "contractId").toUpperCase();
    const tradeDate = requiredText(event.tradeDate, "tradeDate");
    const schedule = getSttSchedule(tradeDate);
    const eventType = requiredText(event.eventType, "eventType");
    const rate = schedule.rates[eventType];
    if (!rate) {
      throw new TypeError("Unsupported STT eventType; physical delivery requires a separate settlement calculation.");
    }
    const taxableValuePaise = event.taxableValuePaise;
    assertPaise(taxableValuePaise, "taxableValuePaise");
    if (taxableValuePaise === 0 && eventType !== "OPTIONS_EXERCISE_BUY") {
      throw new TypeError("Taxable value must be positive for an F&O sell event.");
    }

    const key = JSON.stringify([clientId, contractId, tradeDate, eventType]);
    if (!groups.has(key)) {
      groups.set(key, {
        clientId,
        contractId,
        tradeDate,
        eventType,
        payableBy: rate.payableBy,
        taxableBasis: rate.taxableBasis,
        rateNumerator: rate.numerator,
        rateDenominator: rate.denominator,
        scheduleVersion: schedule.version,
        eventCount: 0,
        taxableValuePaise: 0n
      });
    }
    const group = groups.get(key);
    group.eventCount += 1;
    group.taxableValuePaise += BigInt(taxableValuePaise);
  }

  const results = [];
  for (const group of groups.values()) {
    if (group.taxableValuePaise > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError("Aggregated taxable value exceeds the supported safe integer range.");
    }
    const taxableValuePaise = Number(group.taxableValuePaise);
    // STT Rules rule 4 requires taxable transaction value to be rounded to
    // nearest rupee before calculating the payable STT amount.
    const taxableValueRupees = roundPaiseToNearestRupee(taxableValuePaise);
    const sttRupees = roundRatioHalfUp(
      BigInt(taxableValueRupees) * BigInt(group.rateNumerator),
      BigInt(group.rateDenominator)
    );
    results.push(Object.freeze({
      clientId: group.clientId,
      contractId: group.contractId,
      tradeDate: group.tradeDate,
      eventType: group.eventType,
      payableBy: group.payableBy,
      taxableBasis: group.taxableBasis,
      eventCount: group.eventCount,
      taxableValuePaise,
      taxableValueRupees,
      rateNumerator: group.rateNumerator,
      rateDenominator: group.rateDenominator,
      sttRupees,
      sttPaise: sttRupees * 100,
      scheduleVersion: group.scheduleVersion,
      aggregationKey: "CLIENT_CONTRACT_TRADE_DATE_EVENT"
    }));
  }

  return Object.freeze(results.sort((a, b) =>
    a.clientId.localeCompare(b.clientId) ||
    a.contractId.localeCompare(b.contractId) ||
    a.eventType.localeCompare(b.eventType)
  ));
}

module.exports = Object.freeze({
  SUPPORTED_FROM,
  VERIFIED_THROUGH,
  aggregateDerivativeStt
});
