"use strict";

const ORDER_ID_PATTERN = /^[a-f0-9]{64}$/;
const CREATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function invalidCursor() {
  return Object.assign(new Error("Order history cursor is invalid."), { status: 400 });
}

function encodePaperOrderCursor(order) {
  const createdAt = order?.created_at;
  const orderId = order?.order_id;
  if (typeof createdAt !== "string" || !CREATED_AT_PATTERN.test(createdAt)
      || !Number.isFinite(Date.parse(createdAt))
      || typeof orderId !== "string" || !ORDER_ID_PATTERN.test(orderId)) {
    throw new TypeError("Cannot encode an invalid paper order cursor.");
  }
  return Buffer.from(JSON.stringify({ createdAt, orderId }), "utf8").toString("base64url");
}

function decodePaperOrderCursor(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 512
      || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalidCursor();
  try {
    const raw = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(raw, "utf8").toString("base64url") !== value) throw invalidCursor();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
        || Object.keys(parsed).length !== 2
        || typeof parsed.createdAt !== "string"
        || !CREATED_AT_PATTERN.test(parsed.createdAt)
        || !Number.isFinite(Date.parse(parsed.createdAt))
        || typeof parsed.orderId !== "string"
        || !ORDER_ID_PATTERN.test(parsed.orderId)) throw invalidCursor();
    return Object.freeze({ createdAt: parsed.createdAt, orderId: parsed.orderId });
  } catch (error) {
    if (error?.status === 400) throw error;
    throw invalidCursor();
  }
}

function paperOrderCursorFilter(cursor) {
  const decoded = decodePaperOrderCursor(
    Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
  );
  return "created_at.lt." + decoded.createdAt
    + ",and(created_at.eq." + decoded.createdAt + ",order_id.lt." + decoded.orderId + ")";
}

module.exports = { encodePaperOrderCursor, decodePaperOrderCursor, paperOrderCursorFilter };
