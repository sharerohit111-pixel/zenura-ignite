"use strict";

/*
 * Bridge from the existing canonical Demo Trade History projection to the
 * synthetic wallet ledger. It deliberately refuses open orders (no authoritative
 * reservations) and Futures (no approved margin/cash-settlement receipt).
 */
const fail = code => { throw Object.assign(new Error(code), { code }); };
const ASSETS = new Set(["EQUITY", "OPTION", "FUTURE"]);
const safe = value => Number.isSafeInteger(value) && value >= 0;
function syncDemoWalletFromTradeHistory({ wallet, historySnapshot } = {}) {
  if (!wallet || typeof wallet.append !== "function" || typeof wallet.snapshot !== "function" ||
      !historySnapshot || !Array.isArray(historySnapshot.orders) ||
      !Array.isArray(historySnapshot.openOrders) || !Array.isArray(historySnapshot.trades)) {
    fail("DEMO_WALLET_CANONICAL_HISTORY_REQUIRED");
  }

  const orders = historySnapshot.orders;
  const trades = historySnapshot.trades;
  const byId = new Map();
  for (const order of orders) {
    if (!order || typeof order.orderId !== "string" || !order.orderId ||
        !ASSETS.has(order.assetClass) || typeof order.createdAt !== "string" ||
        !Number.isFinite(Date.parse(order.createdAt))) fail("DEMO_WALLET_INVALID_CANONICAL_ORDER");
    if (byId.has(order.orderId)) fail("DEMO_WALLET_DUPLICATE_CANONICAL_ORDER");
    byId.set(order.orderId, order);
  }

  // No order can consume funds until its engine supplies an explicit reservation receipt.
  if (historySnapshot.openOrders.length) fail("DEMO_WALLET_ORDER_RESERVATION_RECEIPTS_REQUIRED");

  const prepared = [];
  for (const order of orders) {
    prepared.push({
      eventId: "wallet-order-ref-" + order.orderId,
      sourceEventId: order.orderId,
      evidenceRef: "canonical-demo-order:" + order.orderId,
      occurredAt: order.createdAt,
      assetClass: order.assetClass,
      type: "ORDER_REFERENCE",
      orderId: order.orderId
    });
  }

  const seenFills = new Set();
  for (const trade of trades) {
    if (!trade || typeof trade.fillId !== "string" || !trade.fillId ||
        typeof trade.orderId !== "string" || !byId.has(trade.orderId) ||
        !Number.isSafeInteger(trade.quantity) || trade.quantity < 1 ||
        !Number.isSafeInteger(trade.pricePaise) || trade.pricePaise < 1 ||
        !safe(trade.grossValuePaise) || trade.grossValuePaise < 1 ||
        trade.quantity * trade.pricePaise !== trade.grossValuePaise ||
        typeof trade.filledAt !== "string" || !Number.isFinite(Date.parse(trade.filledAt))) {
      fail("DEMO_WALLET_INVALID_CANONICAL_FILL");
    }
    if (seenFills.has(trade.fillId)) fail("DEMO_WALLET_DUPLICATE_CANONICAL_FILL");
    seenFills.add(trade.fillId);
    const order = byId.get(trade.orderId);
    if (trade.assetClass !== order.assetClass || trade.side !== order.side) {
      fail("DEMO_WALLET_FILL_ORDER_ASSET_MISMATCH");
    }
    if (trade.assetClass === "FUTURE") fail("DEMO_WALLET_FUTURES_MARGIN_RECEIPT_REQUIRED");
    if (!["EQUITY", "OPTION"].includes(trade.assetClass) || !["BUY", "SELL"].includes(trade.side)) {
      fail("DEMO_WALLET_UNSUPPORTED_CANONICAL_FILL");
    }
    prepared.push({
      eventId: "wallet-fill-cash-" + trade.fillId,
      sourceEventId: trade.fillId,
      evidenceRef: "canonical-demo-fill:" + trade.fillId,
      occurredAt: trade.filledAt,
      assetClass: trade.assetClass,
      type: "CASH_MOVEMENT",
      orderId: trade.orderId,
      fillId: trade.fillId,
      cashDeltaPaise: trade.side === "BUY" ? -trade.grossValuePaise : trade.grossValuePaise
    });
  }

  // Preflight all cash arithmetic before mutating the ledger.
  const before = wallet.snapshot();
  let projectedCash = before.cashPaise;
  for (const event of prepared) {
    if (event.type !== "CASH_MOVEMENT") continue;
    projectedCash += event.cashDeltaPaise;
    if (!Number.isSafeInteger(projectedCash) || projectedCash < 0) {
      fail("DEMO_WALLET_CASH_OUT_OF_RANGE");
    }
  }

  for (const event of prepared) wallet.append(event);
  return {
    snapshot: wallet.snapshot(),
    sourceOrderCount: orders.length,
    sourceFillCount: trades.length,
    reservationsImported: 0,
    integrationStatus: "EQUITY_AND_OPTION_FILL_CASH_ONLY",
    blockers: [
      "Open orders are rejected until the originating engine emits authoritative reservation receipts.",
      "Futures are rejected until approved deterministic margin and settlement receipts exist.",
      "Charges, taxes and fees are not modelled by the current Demo engines and are not deducted.",
      "The source projection is browser-memory state; no atomic durable snapshot attestation exists."
    ]
  };
}
module.exports = { syncDemoWalletFromTradeHistory };
