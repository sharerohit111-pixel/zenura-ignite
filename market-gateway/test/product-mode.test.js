"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PRODUCT_MODES,
  normalizeProductMode,
  resolveOrderProduct,
  getProductPositionFieldNames
} = require("../lib/product-mode");

test("defaults an omitted product mode to Delivery", () => {
  assert.equal(normalizeProductMode(undefined), PRODUCT_MODES.DELIVERY);
});

test("accepts only the two explicit product modes", () => {
  assert.equal(normalizeProductMode("DELIVERY"), PRODUCT_MODES.DELIVERY);
  assert.equal(normalizeProductMode("INTRADAY"), PRODUCT_MODES.INTRADAY);
  for (const value of [null, "", "delivery", "intraday", "MARGIN", 1, {}, []]) {
    assert.equal(normalizeProductMode(value), null);
  }
});

test("resolves legacy orders without a product as Delivery", () => {
  assert.equal(resolveOrderProduct({ side: "BUY" }), PRODUCT_MODES.DELIVERY);
  assert.equal(resolveOrderProduct({ product: "DELIVERY" }), PRODUCT_MODES.DELIVERY);
  assert.equal(resolveOrderProduct({ product: "INTRADAY" }), PRODUCT_MODES.INTRADAY);
  assert.equal(resolveOrderProduct({ product: null }), null);
  assert.equal(resolveOrderProduct(null), null);
  assert.equal(resolveOrderProduct([]), null);
});

test("maps Delivery and Intraday to isolated position and P&L fields", () => {
  assert.deepEqual(getProductPositionFieldNames("DELIVERY"), {
    product: "DELIVERY",
    positionsField: "positions",
    reservedPositionsField: "reservedPositions",
    realizedPnlField: "deliveryRealizedPnlPaise"
  });
  assert.deepEqual(getProductPositionFieldNames("INTRADAY"), {
    product: "INTRADAY",
    positionsField: "intradayPositions",
    reservedPositionsField: "intradayReservedPositions",
    realizedPnlField: "intradayRealizedPnlPaise"
  });
  assert.equal(getProductPositionFieldNames("UNKNOWN"), null);
});

test("field selection is pure and does not mutate legacy account data", () => {
  const account = {
    positions: { "NSE_EQ|ABC": { quantity: 3 } },
    reservedPositions: {},
    realizedPnlPaise: 125
  };
  const before = structuredClone(account);
  const fields = getProductPositionFieldNames("INTRADAY");
  assert.equal(fields.positionsField, "intradayPositions");
  assert.deepEqual(account, before);
  assert.equal(Object.hasOwn(account, "intradayPositions"), false);
});
