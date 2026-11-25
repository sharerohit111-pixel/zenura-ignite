"use strict";

const PRODUCT_MODES = Object.freeze({
  DELIVERY: "DELIVERY",
  INTRADAY: "INTRADAY"
});

function normalizeProductMode(value) {
  if (value === undefined) return PRODUCT_MODES.DELIVERY;
  if (value === PRODUCT_MODES.DELIVERY || value === PRODUCT_MODES.INTRADAY) return value;
  return null;
}

function resolveOrderProduct(order) {
  if (!order || typeof order !== "object" || Array.isArray(order)) return null;
  if (!Object.prototype.hasOwnProperty.call(order, "product")) return PRODUCT_MODES.DELIVERY;
  return normalizeProductMode(order.product);
}

function getProductPositionFieldNames(product) {
  const mode = normalizeProductMode(product);
  if (mode === null) return null;
  if (mode === PRODUCT_MODES.INTRADAY) {
    return Object.freeze({
      product: mode,
      positionsField: "intradayPositions",
      reservedPositionsField: "intradayReservedPositions",
      realizedPnlField: "intradayRealizedPnlPaise"
    });
  }
  return Object.freeze({
    product: mode,
    positionsField: "positions",
    reservedPositionsField: "reservedPositions",
    realizedPnlField: "deliveryRealizedPnlPaise"
  });
}

module.exports = {
  PRODUCT_MODES,
  normalizeProductMode,
  resolveOrderProduct,
  getProductPositionFieldNames
};
