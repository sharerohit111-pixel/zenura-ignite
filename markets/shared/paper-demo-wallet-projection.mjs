const safeInteger = Number.isSafeInteger;
const clone = value => JSON.parse(JSON.stringify(value));
const fail = code => { throw new TypeError(code); };

function assertSafeNonNegative(value, code) {
  if (!safeInteger(value) || value < 0) fail(code);
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Build a read-only wallet view from the canonical account/session event-ledger
 * snapshot. This is a projection only: it owns no events, reservations,
 * settlement logic, persistence, or reconciliation authority.
 */
export function projectPaperDemoWallet(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
      !snapshot.account || typeof snapshot.account !== "object" ||
      !Array.isArray(snapshot.orders) || !Array.isArray(snapshot.fills) ||
      !Array.isArray(snapshot.positions) || !Array.isArray(snapshot.events)) {
    fail("CANONICAL_DEMO_LEDGER_SNAPSHOT_REQUIRED");
  }

  const account = snapshot.account;
  if (typeof account.accountId !== "string" || !account.accountId ||
      typeof account.sessionId !== "string" || !account.sessionId) {
    fail("CANONICAL_DEMO_LEDGER_IDENTITY_REQUIRED");
  }
  assertSafeNonNegative(account.cashBalancePaise, "INVALID_CANONICAL_CASH_BALANCE");
  assertSafeNonNegative(account.blockedFundsPaise, "INVALID_CANONICAL_BLOCKED_FUNDS");
  assertSafeNonNegative(account.availableFundsPaise, "INVALID_CANONICAL_AVAILABLE_FUNDS");
  if (account.blockedFundsPaise > account.cashBalancePaise ||
      account.cashBalancePaise - account.blockedFundsPaise !== account.availableFundsPaise) {
    fail("CANONICAL_WALLET_BALANCE_INVARIANT");
  }
  if (!safeInteger(account.realizedPnlPaise)) fail("INVALID_CANONICAL_REALIZED_PNL");

  snapshot.events.forEach((event, index) => {
    if (!event || event.sequence !== index + 1 ||
        event.accountId !== account.accountId || event.sessionId !== account.sessionId ||
        typeof event.occurredAt !== "string" || !Number.isFinite(Date.parse(event.occurredAt))) {
      fail("CANONICAL_WALLET_EVENT_STREAM_INVALID");
    }
  });

  const orderIds = new Set();
  for (const order of snapshot.orders) {
    if (!order || typeof order.orderId !== "string" || !order.orderId ||
        orderIds.has(order.orderId) || !Number.isSafeInteger(order.quantity) || order.quantity < 1 ||
        !Number.isSafeInteger(order.filledQuantity) || order.filledQuantity < 0 ||
        !Number.isSafeInteger(order.remainingQuantity) || order.remainingQuantity < 0 ||
        order.filledQuantity + order.remainingQuantity !== order.quantity) {
      fail("CANONICAL_WALLET_ORDER_PROJECTION_INVALID");
    }
    orderIds.add(order.orderId);
  }

  const fillIds = new Set();
  for (const fill of snapshot.fills) {
    if (!fill || typeof fill.fillId !== "string" || !fill.fillId ||
        fillIds.has(fill.fillId) || !orderIds.has(fill.orderId) ||
        !Number.isSafeInteger(fill.quantity) || fill.quantity < 1 ||
        !Number.isSafeInteger(fill.pricePaise) || fill.pricePaise < 1 ||
        !Number.isSafeInteger(fill.quantity * fill.pricePaise) ||
        typeof fill.occurredAt !== "string" || !Number.isFinite(Date.parse(fill.occurredAt))) {
      fail("CANONICAL_WALLET_FILL_PROJECTION_INVALID");
    }
    fillIds.add(fill.fillId);
  }

  for (const position of snapshot.positions) {
    if (!position || typeof position.key !== "string" || !position.key ||
        !Number.isSafeInteger(position.quantity) ||
        !Number.isSafeInteger(position.reservedQuantity) || position.reservedQuantity < 0 ||
        !Number.isSafeInteger(position.costBasisPaise) || position.costBasisPaise < 0 ||
        !Number.isSafeInteger(position.averagePricePaise) || position.averagePricePaise < 0 ||
        !Number.isSafeInteger(position.realizedPnlPaise) ||
        position.reservedQuantity > Math.max(0, position.quantity)) {
      fail("CANONICAL_WALLET_POSITION_PROJECTION_INVALID");
    }
  }

  return freeze({
    source: "CANONICAL_DEMO_EVENT_LEDGER",
    account: {
      accountId: account.accountId,
      sessionId: account.sessionId,
      openingCashPaise: account.openingCashPaise,
      cashBalancePaise: account.cashBalancePaise,
      blockedFundsPaise: account.blockedFundsPaise,
      availableFundsPaise: account.availableFundsPaise,
      realizedPnlPaise: account.realizedPnlPaise,
      ledgerReconciled: false
    },
    orders: clone(snapshot.orders),
    fills: clone(snapshot.fills),
    positions: clone(snapshot.positions),
    eventCount: snapshot.events.length,
    lastSequence: snapshot.events.length
  });
}
