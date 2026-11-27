"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  roundNonNegativeRatioHalfUp,
  roundPaiseToNearestRupee,
  sumPaiseAndRoundToNearestRupee,
  calculatePercentageTaxRoundedToRupees
} = require("../lib/statutory-rounding");

test("nearest rupee statutory boundary is 49 paise down and 50 paise up", () => {
  assert.equal(roundPaiseToNearestRupee(49), 0);
  assert.equal(roundPaiseToNearestRupee(50), 1);
  assert.equal(roundPaiseToNearestRupee(149), 1);
  assert.equal(roundPaiseToNearestRupee(150), 2);
  assert.equal(roundPaiseToNearestRupee(199), 2);
  assert.equal(roundPaiseToNearestRupee(200), 2);
});

test("aggregate paise before applying the nearest-rupee rule", () => {
  const result = sumPaiseAndRoundToNearestRupee([25, 25]);
  assert.deepEqual(result, {
    totalPaise: 50,
    payableRupees: 1,
    roundedPayablePaise: 100
  });
  // Demonstrates why independently rounding each partial amount is wrong:
  // 25p + 25p aggregates to 50p and therefore one rupee.
});

test("large aggregate uses BigInt and does not overflow intermediate addition", () => {
  const result = sumPaiseAndRoundToNearestRupee([4_000_000_000_000, 4_000_000_000_000]);
  assert.equal(result.totalPaise, 8_000_000_000_000);
  assert.equal(result.payableRupees, 80_000_000_000);
});

test("GST 18 percent is calculated with exact integer ratio and rounded to rupees", () => {
  const below = calculatePercentageTaxRoundedToRupees({
    basePaise: 2_00,
    rateNumerator: 18,
    rateDenominator: 100
  });
  const above = calculatePercentageTaxRoundedToRupees({
    basePaise: 3_00,
    rateNumerator: 18,
    rateDenominator: 100
  });
  assert.equal(below.payableRupees, 0); // ₹2 × 18% = ₹0.36
  assert.equal(above.payableRupees, 1); // ₹3 × 18% = ₹0.54
  assert.equal(above.roundedPayablePaise, 100);
});

test("percentage rounding handles an exact half-rupee tie upward", () => {
  const result = calculatePercentageTaxRoundedToRupees({
    basePaise: 2_50,
    rateNumerator: 20,
    rateDenominator: 100
  });
  assert.equal(result.payableRupees, 1); // ₹2.50 × 20% = ₹0.50
});

test("BigInt ratio rounding is exact at half boundaries", () => {
  assert.equal(roundNonNegativeRatioHalfUp(49n, 100n), 0);
  assert.equal(roundNonNegativeRatioHalfUp(50n, 100n), 1);
  assert.equal(roundNonNegativeRatioHalfUp(149n, 100n), 1);
  assert.equal(roundNonNegativeRatioHalfUp(150n, 100n), 2);
});

test("invalid and unsafe inputs fail closed", () => {
  assert.throws(() => roundPaiseToNearestRupee(-1), /non-negative/);
  assert.throws(() => roundPaiseToNearestRupee(Number.MAX_SAFE_INTEGER + 1), /non-negative/);
  assert.throws(() => sumPaiseAndRoundToNearestRupee([]), /non-empty/);
  assert.throws(() => sumPaiseAndRoundToNearestRupee([Number.MAX_SAFE_INTEGER, 1]), /safe integer range/);
  assert.throws(() => calculatePercentageTaxRoundedToRupees({
    basePaise: 100, rateNumerator: -1, rateDenominator: 100
  }), /rate numerator/);
  assert.throws(() => calculatePercentageTaxRoundedToRupees({
    basePaise: 100, rateNumerator: 18, rateDenominator: 0
  }), /rate numerator/);
  assert.throws(() => roundNonNegativeRatioHalfUp(1n, 0n), /positive denominator/);
});
