import { createPaperDemoEventLedger } from "../shared/paper-demo-event-ledger.mjs";

const safeDelta = (after, before) => {
  const value = after - before;
  if (!Number.isSafeInteger(value)) throw new TypeError("EQUITY_LEDGER_DELTA_OUT_OF_RANGE");
  return value;
};
const positionFor = (snapshot, product, instrumentKey) => {
  const map = product === "INTRADAY" ? snapshot.account.intradayPositions : snapshot.account.positions;
  return map?.[instrumentKey] || { quantity: 0, costBasisPaise: 0, reservedQuantity: 0 };
};

export function createEquityDemoLedgerBridge({ engine, accountId, sessionId, ledger: sharedLedger, nextTimestamp, clock = () => Date.now() } = {}) {
  if (!engine || typeof engine.snapshot !== "function" || typeof engine.submitOrder !== "function" ||
      typeof engine.matchNext !== "function" || typeof engine.cancelOrder !== "function") {
    throw new TypeError("EQUITY_DEMO_ENGINE_REQUIRED");
  }
  if (typeof accountId !== "string" || !accountId.startsWith("mock-") ||
      typeof sessionId !== "string" || !sessionId.startsWith("demo-")) {
    throw new TypeError("EQUITY_DEMO_SCOPE_REQUIRED");
  }
  const initial = engine.snapshot();
  if (initial.mode !== "MOCK" || initial.simulated !== true || initial.source !== "SYNTHETIC_FIXTURE") {
    throw new TypeError("EQUITY_DEMO_ENGINE_NOT_SYNTHETIC");
  }
  const ledger = sharedLedger || createPaperDemoEventLedger({
    accountId, sessionId,
    cashBalancePaise: initial.account.cashBalancePaise,
    blockedFundsPaise: initial.account.blockedFundsPaise
  });
  const openingProjection = ledger.snapshot();
  if (openingProjection.account.accountId !== accountId || openingProjection.account.sessionId !== sessionId ||
      openingProjection.account.cashBalancePaise !== initial.account.cashBalancePaise ||
      openingProjection.account.blockedFundsPaise !== initial.account.blockedFundsPaise) {
    throw new TypeError("EQUITY_SHARED_LEDGER_OPENING_MISMATCH");
  }
  let eventSequence = ledger.snapshot().events.filter(event => event.engine === "EQUITY").length, lastTimestamp = -Infinity;
  const submitted = new Map(), executions = new Map(), cancellations = new Map(), rejections = new Map();

  function append(type, payload, deltas, sourceKey) {
    const time = nextTimestamp ? Number(nextTimestamp()) : Math.max(Number(clock()), lastTimestamp + 1);
    if (!Number.isFinite(time)) throw new TypeError("INVALID_EQUITY_LEDGER_CLOCK");
    lastTimestamp = time;
    eventSequence += 1;
    const id = String(eventSequence).padStart(8, "0");
    return ledger.append({
      eventId: "eq-ledger-" + id,
      idempotencyKey: "eq-idem-" + id,
      sourceEventId: "equity-" + String(sourceKey).replace(/[^A-Za-z0-9._:-]/g, "-"),
      accountId, sessionId,
      occurredAt: new Date(time).toISOString(),
      engine: "EQUITY", type, payload, deltas
    });
  }
  function orderPayload(order) {
    return {
      orderId: order.orderId, assetClass: "EQUITY", instrumentKey: order.instrumentKey,
      product: order.product, side: order.side, orderType: order.orderType,
      quantity: order.quantity, status: order.status, symbol: order.symbol,
      filledQuantity: order.filledQuantity, remainingQuantity: order.remainingQuantity,
      limitPricePaise: order.limitPricePaise, averagePricePaise: order.averagePricePaise,
      grossValuePaise: order.grossValuePaise, reservedCashPaise: order.reservedCashPaise
    };
  }
  function requireAuthoritativeWalletReceiptPath() {
    // No Equity receipt adapter is wired into this bridge yet. Refuse before mutating the execution engine.
    throw new TypeError("EQUITY_WALLET_RECEIPT_GATE_CLOSED");
  }
  function submitOrder(request) {
    requireAuthoritativeWalletReceiptPath();
    const rejectionKey = request?.idempotencyKey;
    if (typeof rejectionKey === "string" && rejections.has(rejectionKey)) throw rejections.get(rejectionKey);
    let order;
    try {
      order = engine.submitOrder(request);
    } catch (error) {
      const validRejection = request && typeof request.instrumentKey === "string" && request.instrumentKey.startsWith("MOCK|") &&
        ["BUY", "SELL"].includes(request.side) && ["MARKET", "LIMIT"].includes(request.orderType) &&
        ["DELIVERY", "INTRADAY"].includes(request.product) && Number.isSafeInteger(request.quantity) &&
        request.quantity > 0 && request.quantity <= 1000000 &&
        typeof rejectionKey === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(rejectionKey);
      if (validRejection && !rejections.has(rejectionKey)) {
        const orderId = "DEMO-EQ-" + rejectionKey;
        append("ORDER_REJECTED", {
          orderId, assetClass: "EQUITY", instrumentKey: request.instrumentKey,
          product: request.product, side: request.side, orderType: request.orderType,
          quantity: request.quantity, status: "REJECTED",
          rejectionCode: error.code || error.message || "DEMO_ORDER_REJECTED"
        }, { cashDeltaPaise: 0, blockedDeltaPaise: 0 }, "rejected-" + orderId);
        rejections.set(rejectionKey, error);
      }
      throw error;
    }
    if (submitted.has(order.orderId)) return { order, snapshot: ledger.snapshot() };
    const after = engine.snapshot();
    const before = {
      cashBalancePaise: initial.account.cashBalancePaise,
      blockedFundsPaise: initial.account.blockedFundsPaise
    };
    // For subsequent submissions, derive the pre-submit account state by reversing this order's reservation.
    const reserve = order.side === "BUY" ? order.reservedCashPaise : 0;
    const blockedDeltaPaise = order.side === "BUY" ? reserve : 0;
    append("ORDER_ACCEPTED", orderPayload(order), {
      cashDeltaPaise: 0, blockedDeltaPaise
    }, "order-" + order.orderId);
    submitted.set(order.orderId, true);
    return { order, snapshot: ledger.snapshot(), engineSnapshot: after, openingSnapshot: before };
  }
  function matchNext(orderId, options = {}) {
    requireAuthoritativeWalletReceiptPath();
    const executionId = options.executionId || "equity-exec-" + (executions.size + 1);
    if (executions.has(executionId)) return executions.get(executionId);
    const before = engine.snapshot();
    const result = engine.matchNext(orderId, { ...options, executionId });
    if (!result.matched) return result;
    const after = engine.snapshot(), fill = result.fill;
    append("FILL_RECORDED", {
      fillId: fill.fillId, orderId: fill.orderId, assetClass: "EQUITY",
      instrumentKey: fill.instrumentKey, product: fill.product, side: fill.side,
      quantity: fill.quantity, pricePaise: fill.pricePaise, orderType: result.order.orderType,
      grossPaise: fill.grossValuePaise, executedAt: fill.filledAt, symbol: fill.symbol
    }, {
      cashDeltaPaise: safeDelta(after.account.cashBalancePaise, before.account.cashBalancePaise),
      blockedDeltaPaise: safeDelta(after.account.blockedFundsPaise, before.account.blockedFundsPaise)
    }, "fill-" + fill.fillId);
    const oldPosition = positionFor(before, fill.product, fill.instrumentKey);
    const newPosition = positionFor(after, fill.product, fill.instrumentKey);
    append("POSITION_CHANGED", {
      assetClass: "EQUITY", instrumentKey: fill.instrumentKey, product: fill.product,
      quantityDelta: safeDelta(newPosition.quantity, oldPosition.quantity),
      costBasisDeltaPaise: safeDelta(newPosition.costBasisPaise, oldPosition.costBasisPaise),
      realizedPnlDeltaPaise: fill.realizedPnlPaise, symbol: fill.symbol
    }, { cashDeltaPaise: 0, blockedDeltaPaise: 0 }, "position-" + fill.fillId);
    append("ORDER_UPDATED", orderPayload(result.order), {
      cashDeltaPaise: 0, blockedDeltaPaise: 0
    }, "order-update-" + fill.fillId);
    const bridged = { ...result, snapshot: ledger.snapshot() };
    executions.set(executionId, bridged);
    return bridged;
  }
  function cancelOrder(orderId) {
    requireAuthoritativeWalletReceiptPath();
    if (cancellations.has(orderId)) return cancellations.get(orderId);
    const before = engine.snapshot();
    const result = engine.cancelOrder(orderId);
    if (!result.cancelled) return result;
    const after = engine.snapshot();
    append("ORDER_UPDATED", {
      ...orderPayload(result.order),
      reservedQuantityDelta: result.releasedShareQuantity ? -result.releasedShareQuantity : 0
    }, {
      cashDeltaPaise: safeDelta(after.account.cashBalancePaise, before.account.cashBalancePaise),
      blockedDeltaPaise: safeDelta(after.account.blockedFundsPaise, before.account.blockedFundsPaise)
    }, "cancel-" + orderId);
    const bridged = { ...result, snapshot: ledger.snapshot() };
    cancellations.set(orderId, bridged);
    return bridged;
  }
  for (const [product, positions] of [["DELIVERY", initial.account.positions], ["INTRADAY", initial.account.intradayPositions]]) {
    for (const [instrumentKey, position] of Object.entries(positions || {})) {
      if (!instrumentKey.startsWith("MOCK|")) throw new TypeError("NON_MOCK_OPENING_POSITION");
      append("POSITION_CHANGED", {
        assetClass: "EQUITY", instrumentKey, product,
        quantityDelta: position.quantity,
        costBasisDeltaPaise: position.costBasisPaise,
        reservedQuantityDelta: position.reservedQuantity || 0,
        realizedPnlDeltaPaise: 0
      }, { cashDeltaPaise: 0, blockedDeltaPaise: 0 }, "opening-" + product + "-" + instrumentKey);
    }
  }
  return Object.freeze({
    submitOrder, matchNext, cancelOrder,
    snapshot: () => ledger.snapshot(),
    engineSnapshot: () => engine.snapshot(),
    getOrder: id => engine.getOrder(id),
    getFillReceipts: id => engine.getFillReceipts(id)
  });
}
