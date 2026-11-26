"use strict";

// Pure quote-side trigger policy for Indian derivative LIMIT orders.
// This is deliberately not connected to order routes or workers: SQL must
// revalidate the quote/order under account -> order -> position locks.

function assertPositiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

function evaluateDerivativeLimitQuote({
  side,
  limitPricePaise,
  bidPricePaise,
  askPricePaise,
  quoteTimestampMs,
  nowMs,
  maxQuoteAgeMs = 15000,
}) {
  if (side !== "BUY" && side !== "SELL") {
    throw new TypeError('side must be "BUY" or "SELL"');
  }
  assertPositiveSafeInteger(limitPricePaise, "limitPricePaise");
  assertPositiveSafeInteger(quoteTimestampMs, "quoteTimestampMs");
  assertPositiveSafeInteger(nowMs, "nowMs");
  assertPositiveSafeInteger(maxQuoteAgeMs, "maxQuoteAgeMs");

  const executablePricePaise = side === "BUY" ? askPricePaise : bidPricePaise;
  if (!Number.isSafeInteger(executablePricePaise) || executablePricePaise <= 0) {
    return Object.freeze({ eligible: false, reason: "MISSING_EXECUTABLE_SIDE", quoteAgeMs: null, executablePricePaise: null });
  }

  if (quoteTimestampMs > nowMs) {
    return Object.freeze({ eligible: false, reason: "FUTURE_QUOTE", quoteAgeMs: null, executablePricePaise });
  }

  const quoteAgeMs = nowMs - quoteTimestampMs;
  if (quoteAgeMs > maxQuoteAgeMs) {
    return Object.freeze({ eligible: false, reason: "STALE_QUOTE", quoteAgeMs, executablePricePaise });
  }

  const crossed = side === "BUY"
    ? executablePricePaise <= limitPricePaise
    : executablePricePaise >= limitPricePaise;

  return Object.freeze({
    eligible: crossed,
    reason: crossed ? "LIMIT_REACHED" : "LIMIT_NOT_REACHED",
    quoteAgeMs,
    executablePricePaise,
  });
}

module.exports = { evaluateDerivativeLimitQuote };
