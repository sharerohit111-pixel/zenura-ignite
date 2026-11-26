"use strict";

// Independent, read-only checker for the schema-1.2.0 synthetic Demo event envelope.
// This intentionally does not import or call the production event-ledger reducer.
const crypto = require("node:crypto");
const VERSION = "1.2.0";
const TYPES = new Set(["ORDER_ACCEPTED", "ORDER_UPDATED", "ORDER_REJECTED", "FILL_RECORDED", "RESERVATION_CHANGED", "POSITION_CHANGED"]);
const ENGINES = new Set(["EQUITY", "FUTURES", "OPTIONS"]);
const ASSETS = new Set(["EQUITY", "FUTURE", "OPTION"]);
const TERMINAL = new Set(["FILLED", "CANCELLED", "REJECTED", "EXPIRED"]);
const integer = Number.isSafeInteger;
const fail = (code) => { throw new TypeError(code); };
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const canonical = (v) => {
  if (Array.isArray(v)) return v.map(canonical);
  if (object(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
};
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const key = (asset, instrument, product) => asset + "|" + instrument + "|" + product;

function reconcileDemoEventStream({ opening, events, provenance = null } = {}) {
  if (!object(opening) || !Array.isArray(events)) fail("RECONCILIATION_INPUT_REQUIRED");
  if (typeof opening.accountId !== "string" || !opening.accountId ||
      typeof opening.sessionId !== "string" || !opening.sessionId ||
      !integer(opening.cashBalancePaise) || opening.cashBalancePaise < 0 ||
      !integer(opening.blockedFundsPaise) || opening.blockedFundsPaise < 0 ||
      opening.blockedFundsPaise > opening.cashBalancePaise) fail("INVALID_OPENING_SNAPSHOT");

  let cash = opening.cashBalancePaise;
  let blocked = opening.blockedFundsPaise;
  let realized = 0;
  let previousTime = -Infinity;
  const ids = new Set(), idempotency = new Set(), sources = new Set(), fills = new Set();
  const orders = new Map(), positions = new Map();
  const findings = [];

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!object(e) || e.schemaVersion !== VERSION || e.sequence !== i + 1 ||
        e.accountId !== opening.accountId || e.sessionId !== opening.sessionId ||
        !ENGINES.has(e.engine) || !TYPES.has(e.type) ||
        typeof e.eventId !== "string" || !e.eventId ||
        typeof e.idempotencyKey !== "string" || !e.idempotencyKey ||
        typeof e.sourceEventId !== "string" || !e.sourceEventId ||
        !object(e.deltas) || !integer(e.deltas.cashDeltaPaise) ||
        !integer(e.deltas.blockedDeltaPaise) || !object(e.payload)) fail("INVALID_EVENT_ENVELOPE:" + (i + 1));
    const time = Date.parse(e.occurredAt);
    if (!Number.isFinite(time) || time <= previousTime) fail("EVENT_TIME_ORDER_INVALID:" + (i + 1));
    previousTime = time;
    const sourceKey = e.engine + "|" + e.sourceEventId;
    if (ids.has(e.eventId) || idempotency.has(e.idempotencyKey) || sources.has(sourceKey)) fail("DUPLICATE_EVENT_IDEMPOTENCY_OR_SOURCE:" + (i + 1));
    ids.add(e.eventId); idempotency.add(e.idempotencyKey); sources.add(sourceKey);

    const nextCash = cash + e.deltas.cashDeltaPaise;
    const nextBlocked = blocked + e.deltas.blockedDeltaPaise;
    if (![nextCash, nextBlocked, nextCash - nextBlocked].every(integer) ||
        nextCash < 0 || nextBlocked < 0 || nextBlocked > nextCash) fail("CASH_BLOCKED_FUNDS_INVARIANT:" + (i + 1));

    const p = e.payload;
    if (e.engine !== "EQUITY" && (e.deltas.cashDeltaPaise !== 0 || e.deltas.blockedDeltaPaise !== 0)) {
      fail("DERIVATIVE_CASH_REQUIRES_AUTHORITATIVE_RECEIPT:" + (i + 1));
    }
    if (e.type === "ORDER_ACCEPTED" || e.type === "ORDER_UPDATED" || e.type === "ORDER_REJECTED") {
      if (typeof p.orderId !== "string" || !p.orderId || !ASSETS.has(p.assetClass) ||
          typeof p.instrumentKey !== "string" || !p.instrumentKey.startsWith("MOCK|") ||
          !["BUY", "SELL"].includes(p.side) || !["MARKET", "LIMIT"].includes(p.orderType) ||
          !["PENDING", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED", "EXPIRED"].includes(p.status) ||
          !integer(p.quantity) || p.quantity < 1) fail("INVALID_ORDER_FACT:" + (i + 1));
      if ((e.engine === "EQUITY" && p.assetClass !== "EQUITY") ||
          (e.engine === "FUTURES" && p.assetClass !== "FUTURE") ||
          (e.engine === "OPTIONS" && p.assetClass !== "OPTION")) fail("ORDER_ENGINE_ASSET_MISMATCH:" + (i + 1));
      const existing = orders.get(p.orderId);
      if (e.type === "ORDER_ACCEPTED" || e.type === "ORDER_REJECTED") {
        if (existing) fail("DUPLICATE_ORDER_ID:" + (i + 1));
        if (e.type === "ORDER_ACCEPTED" && p.status !== "PENDING") fail("INVALID_INITIAL_ORDER_STATUS:" + (i + 1));
        if (e.type === "ORDER_REJECTED" && p.status !== "REJECTED") fail("INVALID_REJECTION_STATUS:" + (i + 1));
        if (e.type === "ORDER_REJECTED" && p.status !== "REJECTED") fail("INVALID_REJECTION_STATUS:" + (i + 1));
      } else {
        if (!existing) fail("ORDER_UPDATE_WITHOUT_ACCEPTANCE:" + (i + 1));
        if (TERMINAL.has(existing.status)) fail("TERMINAL_ORDER_REOPENED:" + (i + 1));
        for (const field of ["assetClass", "instrumentKey", "side", "orderType", "quantity"]) {
          if (existing[field] !== p[field]) fail("ORDER_IDENTITY_CHANGED:" + (i + 1));
        }
        const filled = existing.filled;
        const valid = p.status === "PARTIALLY_FILLED" ? filled > 0 && filled < p.quantity :
          p.status === "FILLED" ? filled === p.quantity :
          ["CANCELLED", "EXPIRED"].includes(p.status) ? filled < p.quantity : false;
        if (!valid) fail("ORDER_STATUS_FILL_QUANTITY_MISMATCH:" + (i + 1));
        if (p.filledQuantity !== undefined && p.filledQuantity !== filled) fail("ORDER_FILLED_QUANTITY_MISMATCH:" + (i + 1));
        if (p.remainingQuantity !== undefined && p.remainingQuantity !== p.quantity - filled) fail("ORDER_REMAINING_QUANTITY_MISMATCH:" + (i + 1));
      }
      const next = { ...(existing || {}), ...p, filled: existing?.filled || 0, engine: e.engine };
      orders.set(p.orderId, next);
    } else if (e.type === "FILL_RECORDED") {
      if (typeof p.fillId !== "string" || !p.fillId || fills.has(p.fillId) ||
          typeof p.orderId !== "string" || !ASSETS.has(p.assetClass) ||
          typeof p.instrumentKey !== "string" || !integer(p.quantity) || p.quantity < 1 ||
          !integer(p.pricePaise) || p.pricePaise < 1) fail("INVALID_OR_DUPLICATE_FILL:" + (i + 1));
      const gross = p.quantity * p.pricePaise;
      if (!integer(gross) || (p.grossPaise !== undefined && p.grossPaise !== gross) ||
          (p.grossValuePaise !== undefined && p.grossValuePaise !== gross) ||
          (p.grossPaise === undefined && p.grossValuePaise === undefined)) fail("FILL_GROSS_MISMATCH:" + (i + 1));
      const order = orders.get(p.orderId);
      if (!order || order.engine !== e.engine || order.assetClass !== p.assetClass ||
          order.instrumentKey !== p.instrumentKey || order.side !== p.side ||
          (order.product || "DELIVERY") !== (p.product || "DELIVERY") || TERMINAL.has(order.status)) {
        fail("FILL_ORDER_BINDING_MISMATCH:" + (i + 1));
      }
      if (e.engine === "EQUITY" && e.deltas.cashDeltaPaise !== (p.side === "BUY" ? -gross : gross)) {
        fail("EQUITY_FILL_CASH_GROSS_MISMATCH:" + (i + 1));
      }
      if (e.engine !== "EQUITY" && (e.deltas.cashDeltaPaise !== 0 || e.deltas.blockedDeltaPaise !== 0)) {
        fail("DERIVATIVE_FILL_RECEIPT_REQUIRED:" + (i + 1));
      }
      if (order.filled + p.quantity > order.quantity) fail("FILL_QUANTITY_EXCEEDS_ORDER:" + (i + 1));
      order.filled += p.quantity;
      fills.add(p.fillId);
    } else if (e.type === "POSITION_CHANGED") {
      if (!ASSETS.has(p.assetClass) || typeof p.instrumentKey !== "string" ||
          !integer(p.quantityDelta) || !integer(p.realizedPnlDeltaPaise) ||
          !integer(p.costBasisDeltaPaise ?? 0)) fail("INVALID_POSITION_FACT:" + (i + 1));
      if (e.deltas.cashDeltaPaise !== 0 || e.deltas.blockedDeltaPaise !== 0) fail("POSITION_EVENT_CANNOT_MOVE_WALLET:" + (i + 1));
      const k = key(p.assetClass, p.instrumentKey, p.product || "DELIVERY");
      const old = positions.get(k) || { quantity: 0, costBasisPaise: 0, realizedPnlPaise: 0 };
      const quantity = old.quantity + p.quantityDelta;
      const cost = old.costBasisPaise + (p.costBasisDeltaPaise || 0);
      if (![quantity, cost].every(integer) || cost < 0 ||
          (p.assetClass !== "FUTURE" && quantity < 0) || (quantity === 0 && cost !== 0)) fail("POSITION_COST_BASIS_INVARIANT:" + (i + 1));
      positions.set(k, { quantity, costBasisPaise: cost, realizedPnlPaise: old.realizedPnlPaise + p.realizedPnlDeltaPaise });
      realized += p.realizedPnlDeltaPaise;
      if (!integer(realized)) fail("REALIZED_PNL_OVERFLOW");
    } else if (e.type === "RESERVATION_CHANGED") {
      if (Object.keys(p).length !== 0 || e.deltas.cashDeltaPaise !== 0) fail("INVALID_RESERVATION_EVENT:" + (i + 1));
    }
    cash = nextCash;
    blocked = nextBlocked;
  }

  if (events.length === 0) findings.push("No historical events supplied; opening balance has no transaction-level corroboration.");
  findings.push("Schema 1.2.0 is a synthetic Demo event stream, not an authoritative persisted ledger export.");
  findings.push("The event schema does not represent fee/charge postings, reversals/refunds, authoritative settlement receipts, dated settlement, or independent market marks.");
  findings.push("Opening-balance and lifetime-history provenance cannot be independently authenticated by this offline reducer.");
  findings.push("No transactionally consistent PostgreSQL snapshot or production ledger write-path verification is performed.");

  const normalized = JSON.stringify(canonical({ opening, events }));
  const report = {
    format: "zenura-s-trade-demo-event-reconciliation-v1",
    inputSha256: sha256(normalized),
    eventCount: events.length,
    fillCount: fills.size,
    orderCount: orders.size,
    positionCount: positions.size,
    openingCashPaise: opening.cashBalancePaise,
    cashBalancePaise: cash,
    blockedFundsPaise: blocked,
    availableCashPaise: cash - blocked,
    realizedPnlPaise: realized,
    positionTotals: [...positions.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([positionKey, value]) => ({ positionKey, ...value })),
    ledgerReconciled: false,
    reconciliationStatus: "blocked_demo_only",
    blockers: findings
  };
  return Object.freeze(report);
}

module.exports = { reconcileDemoEventStream };
