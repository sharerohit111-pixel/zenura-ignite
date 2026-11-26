"use strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateOrderInput } = require("../server");

const key = "123e4567-e89b-42d3-a456-426614174000";
const valid = { symbol: "BTCUSDT", side: "BUY", quantity: "0.001", idempotency_key: key };

test("rejects missing, malformed and unsupported order sides", () => {
  for (const side of [undefined, "", "HOLD", "BUY_TO_COVER", 1, {}]) {
    assert.throws(() => validateOrderInput({ ...valid, side }), /BUY and SELL/);
  }
});

test("rejects malformed idempotency keys", () => {
  for (const idempotency_key of ["", "not-a-uuid", "123e4567-e89b-42d3-a456-426614174000-extra", 7, null]) {
    assert.throws(() => validateOrderInput({ ...valid, idempotency_key }), /UUID/);
  }
});

test("rejects quantity values outside the accepted decimal and magnitude bounds", () => {
  for (const quantity of ["-0.1", "+1", "1e-8", "1,000", "1.1234567890123", "1000000001", "Infinity", "NaN", ""]) {
    assert.throws(() => validateOrderInput({ ...valid, quantity }), /valid quantity/);
  }
});

test("rejects LIMIT prices with excess precision, exponent notation or excessive magnitude", () => {
  for (const limit_price of ["0", "-1", "+1", "1e3", "1.123456789", "1000000001", "Infinity", ""]) {
    assert.throws(() => validateOrderInput({ ...valid, limit_price }, true), /valid LIMIT price/);
  }
});

test("accepts SELL LIMIT inputs at the documented precision boundary", () => {
  const result = validateOrderInput({
    ...valid,
    side: "SELL",
    quantity: "0.000000000001",
    limit_price: "999999999.99999999"
  }, true);
  assert.equal(result.side, "SELL");
  assert.equal(result.quantityRaw, "0.000000000001");
  assert.equal(result.priceRaw, "999999999.99999999");
});
