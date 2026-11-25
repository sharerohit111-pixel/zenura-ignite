import { createPaperDemoEventLedger } from "../shared/paper-demo-event-ledger.mjs";

const safe = value => {
  if (!Number.isSafeInteger(value)) throw new TypeError("DERIVATIVE_LEDGER_DELTA_OUT_OF_RANGE");
  return value;
};
const keyOf = position => position.assetClass + "|" + position.instrumentKey + "|" +
  (position.assetClass === "FUTURE" ? position.product || "DELIVERY" : "DELIVERY");
const costOf = position => safe(Math.abs(position.netQuantity) * position.averagePricePaise);

export function createDerivativeDemoLedgerBridge({
  simulator, accountId = "mock-fo-account", sessionId, clock = () => Date.now()
} = {}) {
  if (!simulator || typeof simulator.snapshot !== "function" ||
      typeof simulator.submit !== "function" || typeof simulator.cancel !== "function" ||
      typeof simulator.processLimitFills !== "function") {
    throw new TypeError("DERIVATIVE_MOCK_SIMULATOR_REQUIRED");
  }
  if (typeof accountId !== "string" || !accountId.startsWith("mock-") ||
      typeof sessionId !== "string" || !sessionId.startsWith("demo-")) {
    throw new TypeError("DERIVATIVE_DEMO_SCOPE_REQUIRED");
  }
  const opening = simulator.snapshot();
  if (opening.mode !== "MOCK" || opening.simulated !== true) {
    throw new TypeError("DERIVATIVE_SIMULATOR_NOT_MOCK");
  }
  const ledger = createPaperDemoEventLedger({
    accountId, sessionId, cashBalancePaise: 0, blockedFundsPaise: 0
  });
  let sequence = 0, lastTime = -Infinity, poisoned = false;
  const requestKeys = new Map(), requestFingerprints = new Map();

  function assertHealthy() {
    if (poisoned) throw new Error("DERIVATIVE_LEDGER_BRIDGE_HALTED_AFTER_PROJECTION_FAILURE");
  }
  function append(engine, type, payload, source) {
    const now = Math.max(Number(clock()), lastTime + 1);
    if (!Number.isFinite(now)) throw new TypeError("INVALID_DERIVATIVE_LEDGER_CLOCK");
    lastTime = now;
    const id = String(++sequence).padStart(9, "0");
    return ledger.append({
      eventId: "fo-ledger-" + id,
      idempotencyKey: "fo-idem-" + id,
      sourceEventId: "fo-" + String(source).replace(/[^A-Za-z0-9._:-]/g, "-"),
      accountId, sessionId, occurredAt: new Date(now).toISOString(),
      engine, type, payload, deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 }
    });
  }
  function engineFor(order) { return order.assetClass === "FUTURE" ? "FUTURES" : "OPTIONS"; }
  function orderPayload(order, status = order.status, extra = {}) {
    return {
      orderId: order.orderId, assetClass: order.assetClass, instrumentKey: order.instrumentKey,
      product: order.assetClass === "FUTURE" ? order.product : "DELIVERY",
      side: order.side, orderType: order.orderType, quantity: order.quantity,
      status, symbol: order.symbol, expiry: order.expiry, optionType: order.optionType,
      strikePaise: order.strikePaise, lots: order.lots, lotSize: order.lotSize,
      limitPricePaise: order.limitPricePaise, filledQuantity: order.filledQuantity, remainingQuantity: order.remainingQuantity,
      averageFillPricePaise: order.averageFillPricePaise, ...extra
    };
  }
  function snapshot() { assertHealthy(); return ledger.snapshot(); }
  function engineSnapshot() { return simulator.snapshot(); }

  function projectChanged(before, after) {
    const oldOrders = new Map(before.orders.map(order => [order.orderId, order]));
    const newOrders = new Map(after.orders.map(order => [order.orderId, order]));
    const newFills = [];
    for (const order of after.orders) {
      const old = oldOrders.get(order.orderId);
      const oldIds = new Set((old?.fills || []).map(fill => fill.fillId));
      for (const fill of order.fills) if (!oldIds.has(fill.fillId)) {
        newFills.push({ order, fill });
      }
    }
    const oldPositions = new Map(before.positions.map(position => [keyOf(position), position]));
    const newPositions = new Map(after.positions.map(position => [keyOf(position), position]));
    const realizedByKey = new Map();
    for (const { order, fill } of newFills) {
      const engine = engineFor(order);
      append(engine, "FILL_RECORDED", {
        fillId: fill.fillId, orderId: order.orderId, assetClass: order.assetClass,
        instrumentKey: order.instrumentKey, product: order.assetClass === "FUTURE" ? order.product : "DELIVERY",
        side: order.side, orderType: order.orderType, quantity: fill.quantity, pricePaise: fill.pricePaise, grossPaise: fill.grossPaise, executedAt: fill.executedAt,
        symbol: order.symbol, expiry: order.expiry, optionType: order.optionType, strikePaise: order.strikePaise,
        realizedPnlPaise: fill.realizedPnlPaise || 0
      }, "fill-" + fill.fillId);
      const key = keyOf({ ...order, netQuantity: 0 });
      realizedByKey.set(key, (realizedByKey.get(key) || 0) + (fill.realizedPnlPaise || 0));
    }
    const changedKeys = new Set([...oldPositions.keys(), ...newPositions.keys()]);
    for (const key of changedKeys) {
      const firstSeparator = key.indexOf("|"), lastSeparator = key.lastIndexOf("|");
      const assetClass = key.slice(0, firstSeparator);
      const instrumentKey = key.slice(firstSeparator + 1, lastSeparator);
      const product = key.slice(lastSeparator + 1);
      const old = oldPositions.get(key) || { netQuantity: 0, averagePricePaise: 0, assetClass, instrumentKey, product };
      const next = newPositions.get(key) || { ...old, netQuantity: 0, averagePricePaise: 0 };
      if (old.netQuantity === next.netQuantity && old.averagePricePaise === next.averagePricePaise) continue;
      const engine = next.assetClass === "FUTURE" ? "FUTURES" : "OPTIONS";
      append(engine, "POSITION_CHANGED", {
        assetClass: next.assetClass, instrumentKey: next.instrumentKey,
        product: next.assetClass === "FUTURE" ? next.product : "DELIVERY",
        quantityDelta: safe(next.netQuantity - old.netQuantity),
        costBasisDeltaPaise: safe(costOf(next) - costOf(old)),
        reservedQuantityDelta: 0, symbol: next.symbol, expiry: next.expiry,
        optionType: next.optionType, strikePaise: next.strikePaise,
        realizedPnlDeltaPaise: safe(realizedByKey.get(key) || 0)
      }, "position-" + key + "-" + after.orders.map(order => order.fills.length).join("-"));
    }
    for (const order of after.orders) {
      const old = oldOrders.get(order.orderId);
      const projected = ledger.snapshot().orders.find(item => item.orderId === order.orderId);
      if (projected && (projected.status !== order.status || (old?.filledQuantity || 0) !== order.filledQuantity)) {
        const reserveRelease = order.assetClass === "OPTION" && order.side === "SELL" &&
          order.status === "CANCELLED" ? -order.remainingQuantity : 0;
        append(engineFor(order), "ORDER_UPDATED", orderPayload(order, order.status, {
          reservedQuantityDelta: reserveRelease
        }), "order-update-" + order.orderId + "-" + order.status + "-" + order.filledQuantity);
      }
    }
  }

  function submit(request) {
    assertHealthy();
    const key = request?.idempotencyKey;
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(key)) {
      throw new TypeError("DERIVATIVE_IDEMPOTENCY_KEY_REQUIRED");
    }
    const fingerprint = JSON.stringify({ ...request, idempotencyKey: undefined });
    if (requestKeys.has(key)) {
      if (requestFingerprints.get(key) !== fingerprint) throw new TypeError("DERIVATIVE_IDEMPOTENCY_KEY_REUSE_MISMATCH");
      return { order: requestKeys.get(key), duplicate: true, snapshot: snapshot() };
    }
    const before = simulator.snapshot();
    const order = simulator.submit(request);
    const after = simulator.snapshot();
    try {
      const engine = engineFor(order);
      if (order.status === "REJECTED") {
        append(engine, "ORDER_REJECTED", orderPayload(order, "REJECTED", {
          rejectionCode: order.rejectionReason || "MOCK_MARKET_REJECTED"
        }), "rejected-" + order.orderId);
      } else {
        append(engine, "ORDER_ACCEPTED", orderPayload(order, "PENDING", {
          reservedQuantityDelta: order.assetClass === "OPTION" && order.side === "SELL" ? order.quantity : 0
        }), "accepted-" + order.orderId);
        projectChanged(before, after);
      }
      requestKeys.set(key, order);
      requestFingerprints.set(key, fingerprint);
      return { order, duplicate: false, snapshot: snapshot() };
    } catch (error) {
      poisoned = true;
      throw error;
    }
  }

  function processLimitFills() {
    assertHealthy();
    const before = simulator.snapshot();
    const result = simulator.processLimitFills();
    const after = simulator.snapshot();
    try { projectChanged(before, after); }
    catch (error) { poisoned = true; throw error; }
    return { ...result, snapshot: snapshot() };
  }

  function cancel(orderId) {
    assertHealthy();
    const before = simulator.snapshot();
    const order = simulator.cancel(orderId);
    const after = simulator.snapshot();
    try {
      const reserveRelease = order.assetClass === "OPTION" && order.side === "SELL" ? -order.remainingQuantity : 0;
      append(engineFor(order), "ORDER_UPDATED", orderPayload(order, "CANCELLED", {
        reservedQuantityDelta: reserveRelease
      }), "cancel-" + order.orderId);
    } catch (error) { poisoned = true; throw error; }
    return { order, snapshot: snapshot() };
  }

  return Object.freeze({
    contracts: () => simulator.contracts(),
    submit, cancel, processLimitFills,
    refreshQuoteDepth: () => simulator.refreshQuoteDepth(),
    snapshot, engineSnapshot
  });
}
