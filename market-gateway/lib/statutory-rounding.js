"use strict";

// Exact statutory rounding primitives. These helpers deliberately do not choose
// the legal aggregation key (trade, client/security/settlement/day, invoice, etc.).
// Callers must aggregate at the scope required by the applicable rule/circular
// before invoking these functions. Do not use these as a substitute for broker
// contract-note reconciliation.

function assertPaise(value, label = "paise") {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(label + " must be a non-negative safe integer.");
  }
}

function roundNonNegativeRatioHalfUp(numerator, denominator) {
  if (typeof numerator !== "bigint" || numerator < 0n ||
      typeof denominator !== "bigint" || denominator <= 0n) {
    throw new TypeError("A non-negative BigInt numerator and positive denominator are required.");
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Rounded statutory amount exceeds the safe integer range.");
  }
  return Number(rounded);
}

// CGST Act section 170 / STT Rules rule 4: nearest rupee; 50 paise rounds up.
function safeRupeesToPaise(rupees) {
  const paise = BigInt(rupees) * 100n;
  if (paise > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Rounded payable paise exceeds the safe integer range.");
  }
  return Number(paise);
}

function roundPaiseToNearestRupee(paise) {
  assertPaise(paise);
  return roundNonNegativeRatioHalfUp(BigInt(paise), 100n);
}

// Aggregate paise first, then apply nearest-rupee rounding once. The caller is
// responsible for selecting the legally correct aggregation boundary.
function sumPaiseAndRoundToNearestRupee(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError("A non-empty array of paise amounts is required.");
  }
  let total = 0n;
  for (const value of values) {
    assertPaise(value);
    total += BigInt(value);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Aggregated paise exceeds the safe integer range.");
  }
  const totalPaise = Number(total);
  const payableRupees = roundNonNegativeRatioHalfUp(total, 100n);
  return Object.freeze({
    totalPaise,
    payableRupees,
    roundedPayablePaise: safeRupeesToPaise(payableRupees)
  });
}

// Calculate a percentage on an already aggregated integer-paise base without
// floating-point arithmetic, then round the resulting payable tax to rupees.
// rateNumerator/rateDenominator are exact rate parts (e.g. 18/100 for GST).
function calculatePercentageTaxRoundedToRupees({ basePaise, rateNumerator, rateDenominator }) {
  assertPaise(basePaise, "basePaise");
  if (!Number.isSafeInteger(rateNumerator) || rateNumerator < 0 ||
      !Number.isSafeInteger(rateDenominator) || rateDenominator <= 0) {
    throw new TypeError("A non-negative integer rate numerator and positive denominator are required.");
  }
  const numerator = BigInt(basePaise) * BigInt(rateNumerator);
  const denominator = BigInt(rateDenominator) * 100n;
  const payableRupees = roundNonNegativeRatioHalfUp(numerator, denominator);
  return Object.freeze({
    basePaise,
    rateNumerator,
    rateDenominator,
    exactTaxNumeratorPaise: numerator.toString(),
    exactTaxDenominator: rateDenominator,
    payableRupees,
    roundedPayablePaise: safeRupeesToPaise(payableRupees)
  });
}

module.exports = Object.freeze({
  roundNonNegativeRatioHalfUp,
  roundPaiseToNearestRupee,
  sumPaiseAndRoundToNearestRupee,
  calculatePercentageTaxRoundedToRupees
});
