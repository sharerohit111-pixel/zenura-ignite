const VERSION = "1.2.0";
const ENGINES = new Set(["EQUITY", "FUTURES", "OPTIONS"]);
const EVENT_TYPES = new Set(["ORDER_ACCEPTED", "ORDER_UPDATED", "ORDER_REJECTED", "FILL_RECORDED", "RESERVATION_CHANGED", "POSITION_CHANGED"]);
const ORDER_STATUSES = new Set(["PENDING", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED", "EXPIRED"]);
const SIDES = new Set(["BUY", "SELL"]);
const ORDER_TYPES = new Set(["MARKET", "LIMIT"]);
const ASSETS = new Set(["EQUITY", "FUTURE", "OPTION"]);
const PRODUCTS = new Set(["DELIVERY", "INTRADAY"]);
const fail = code => { throw new TypeError(code); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value);
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
function validateIdentity(value, name) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) fail("INVALID_" + name);
}
function productOf(payload) {
  return payload.product === undefined ? "DELIVERY" : payload.product;
}
function positionKey(assetClass, instrumentKey, product) {
  return assetClass + "|" + instrumentKey + "|" + product;
}
function timestampMs(value) {
  if (typeof value !== "string") fail("INVALID_EVENT_TIMESTAMP");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) fail("INVALID_EVENT_TIMESTAMP");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] ||
      hour > 23 || minute > 59 || second > 59 ||
      (zone !== "Z" && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59))) {
    fail("INVALID_EVENT_TIMESTAMP");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail("INVALID_EVENT_TIMESTAMP");
  return parsed;
}
function validateEvent(input, identity, expectedSequence) {
  if (!object(input)) fail("INVALID_EVENT");
  if (input.schemaVersion !== VERSION) fail("UNSUPPORTED_EVENT_SCHEMA_VERSION");
  validateIdentity(input.eventId, "EVENT_ID");
  validateIdentity(input.idempotencyKey, "IDEMPOTENCY_KEY");
  validateIdentity(input.sourceEventId, "SOURCE_EVENT_ID");
  if (input.sessionId !== identity.sessionId || input.accountId !== identity.accountId) fail("DEMO_EVENT_SCOPE_MISMATCH");
  if (input.sequence !== expectedSequence) fail("DEMO_EVENT_SEQUENCE_MISMATCH");
  timestampMs(input.occurredAt);
  if (!ENGINES.has(input.engine) || !EVENT_TYPES.has(input.type)) fail("INVALID_EVENT_KIND");
  if (!object(input.deltas)) fail("INVALID_EVENT_DELTAS");
  for (const key of ["cashDeltaPaise", "blockedDeltaPaise"]) {
    if (!integer(input.deltas[key])) fail("INVALID_EVENT_DELTA:" + key);
  }
  const p = input.payload;
  if (!object(p)) fail("INVALID_EVENT_PAYLOAD");
  if (input.type === "ORDER_ACCEPTED" || input.type === "ORDER_UPDATED" || input.type === "ORDER_REJECTED") {
    validateIdentity(p.orderId, "ORDER_ID");
    if (!ASSETS.has(p.assetClass) || !p.instrumentKey?.startsWith("MOCK|") ||
        !SIDES.has(p.side) || !ORDER_TYPES.has(p.orderType) ||
        !ORDER_STATUSES.has(p.status) || (input.type === "ORDER_REJECTED" && p.status !== "REJECTED") || (input.type !== "ORDER_REJECTED" && p.status === "REJECTED") || !integer(p.quantity) || p.quantity < 1 ||
        !PRODUCTS.has(productOf(p)) ||
        (p.reservedQuantityDelta !== undefined && !integer(p.reservedQuantityDelta))) fail("INVALID_ORDER_EVENT");
    if (input.engine === "EQUITY" && p.assetClass !== "EQUITY") fail("ENGINE_ASSET_MISMATCH");
    if (input.engine === "FUTURES" && p.assetClass !== "FUTURE") fail("ENGINE_ASSET_MISMATCH");
    if (input.engine === "OPTIONS" && p.assetClass !== "OPTION") fail("ENGINE_ASSET_MISMATCH");
  }
  if (input.type === "FILL_RECORDED") {
    validateIdentity(p.fillId, "FILL_ID");
    validateIdentity(p.orderId, "ORDER_ID");
    if (!ASSETS.has(p.assetClass) || !p.instrumentKey?.startsWith("MOCK|") ||
        !SIDES.has(p.side) || !integer(p.quantity) || p.quantity < 1 ||
        !integer(p.pricePaise) || p.pricePaise < 1 ||
        !PRODUCTS.has(productOf(p))) fail("INVALID_FILL_EVENT");
    const calculatedGrossPaise = p.quantity * p.pricePaise;
    if (!Number.isSafeInteger(calculatedGrossPaise) || calculatedGrossPaise < 1 ||
        (p.grossPaise === undefined && p.grossValuePaise === undefined) ||
        (p.grossPaise !== undefined && p.grossPaise !== calculatedGrossPaise) ||
        (p.grossValuePaise !== undefined && p.grossValuePaise !== calculatedGrossPaise)) {
      fail("INVALID_FILL_GROSS_VALUE");
    }
    if (input.engine === "EQUITY") {
      const expectedCashDelta = p.side === "BUY" ? -calculatedGrossPaise : calculatedGrossPaise;
      if (input.deltas.cashDeltaPaise !== expectedCashDelta) fail("EQUITY_FILL_CASH_SETTLEMENT_MISMATCH");
    } else if (input.deltas.cashDeltaPaise !== 0 || input.deltas.blockedDeltaPaise !== 0) {
      fail("DERIVATIVE_CASH_SETTLEMENT_RECEIPT_REQUIRED");
    }
    if (input.engine === "EQUITY" && p.assetClass !== "EQUITY") fail("ENGINE_ASSET_MISMATCH");
    if (input.engine === "FUTURES" && p.assetClass !== "FUTURE") fail("ENGINE_ASSET_MISMATCH");
    if (input.engine === "OPTIONS" && p.assetClass !== "OPTION") fail("ENGINE_ASSET_MISMATCH");
  }
  if (input.engine !== "EQUITY" &&
      (input.deltas.cashDeltaPaise !== 0 || input.deltas.blockedDeltaPaise !== 0)) {
    fail("DERIVATIVE_CASH_SETTLEMENT_RECEIPT_REQUIRED");
  }
  if (input.type !== "FILL_RECORDED" && input.deltas.cashDeltaPaise !== 0) {
    fail("UNAUTHORIZED_EVENT_CASH_MOVEMENT");
  }
  if (input.type === "POSITION_CHANGED" &&
      (input.deltas.cashDeltaPaise !== 0 || input.deltas.blockedDeltaPaise !== 0)) {
    fail("UNAUTHORIZED_POSITION_CASH_MOVEMENT");
  }
  if (input.type === "ORDER_REJECTED" && input.deltas.blockedDeltaPaise !== 0) {
    fail("UNAUTHORIZED_REJECTION_RESERVATION_MOVEMENT");
  }
  if (input.type === "POSITION_CHANGED") {
    if (!ASSETS.has(p.assetClass) || !p.instrumentKey?.startsWith("MOCK|") ||
        !integer(p.quantityDelta) || !integer(p.realizedPnlDeltaPaise) ||
        !integer(p.costBasisDeltaPaise ?? 0) || !integer(p.reservedQuantityDelta ?? 0) ||
        !PRODUCTS.has(productOf(p))) fail("INVALID_POSITION_EVENT");
    if (input.engine === "EQUITY" && p.assetClass !== "EQUITY") fail("ENGINE_ASSET_MISMATCH");
    if (input.engine === "FUTURES" && p.assetClass !== "FUTURE") fail("ENGINE_ASSET_MISMATCH");
    if (input.engine === "OPTIONS" && p.assetClass !== "OPTION") fail("ENGINE_ASSET_MISMATCH");
  }
  if (input.type === "RESERVATION_CHANGED" && Object.keys(p).length !== 0) fail("INVALID_RESERVATION_EVENT");
  return freeze(clone(input));
}
function initialProjection(opening) {
  return {
    account: {
      accountId: opening.accountId, sessionId: opening.sessionId,
      openingCashPaise: opening.cashBalancePaise,
      cashBalancePaise: opening.cashBalancePaise,
      blockedFundsPaise: opening.blockedFundsPaise,
      availableFundsPaise: opening.cashBalancePaise - opening.blockedFundsPaise,
      realizedPnlPaise: 0, ledgerReconciled: false
    },
    orders: [], fills: [], positions: [], events: []
  };
}
function apply(projection, event) {
  const cash = projection.account.cashBalancePaise + event.deltas.cashDeltaPaise;
  const blocked = projection.account.blockedFundsPaise + event.deltas.blockedDeltaPaise;
  const available = cash - blocked;
  if (![cash, blocked, available].every(Number.isSafeInteger) || cash < 0 || blocked < 0 || available < 0) fail("DEMO_CASH_RESERVATION_INVARIANT");
  projection.account.cashBalancePaise = cash;
  projection.account.blockedFundsPaise = blocked;
  projection.account.availableFundsPaise = available;
  if (event.type === "ORDER_ACCEPTED" || event.type === "ORDER_UPDATED" || event.type === "ORDER_REJECTED") {
    const p = event.payload, existing = projection.orders.find(x => x.orderId === p.orderId);
    if ((event.type === "ORDER_ACCEPTED" || event.type === "ORDER_REJECTED") && existing) fail("DUPLICATE_ORDER_ID");
    if (event.type === "ORDER_UPDATED" && !existing) fail("ORDER_UPDATE_WITHOUT_ACCEPTANCE");
    if (event.type === "ORDER_ACCEPTED" && p.status !== "PENDING") fail("INVALID_INITIAL_ORDER_STATUS");
    if (event.type === "ORDER_UPDATED") {
      const terminal = new Set(["FILLED", "CANCELLED", "REJECTED", "EXPIRED"]);
      const transitions = {
        PENDING: new Set(["PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED"]),
        PARTIALLY_FILLED: new Set(["PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED"])
      };
      for (const field of ["assetClass", "instrumentKey", "side", "orderType", "quantity", "product"]) {
        if (existing[field] !== (field === "product" ? productOf(p) : p[field])) fail("ORDER_IDENTITY_MUTATION");
      }
      if (terminal.has(existing.status)) fail("ORDER_TERMINAL_STATE_IMMUTABLE");
      if (!transitions[existing.status]?.has(p.status)) fail("INVALID_ORDER_STATUS_TRANSITION");
      const filledQuantity = projection.fills.filter(fill => fill.orderId === p.orderId)
        .reduce((sum, fill) => sum + fill.quantity, 0);
      if (p.status === "PENDING" && filledQuantity !== 0) fail("ORDER_FILL_STATUS_MISMATCH");
      if (p.status === "PARTIALLY_FILLED" && !(filledQuantity > 0 && filledQuantity < p.quantity)) fail("ORDER_FILL_STATUS_MISMATCH");
      if (p.status === "FILLED" && filledQuantity !== p.quantity) fail("ORDER_FILL_STATUS_MISMATCH");
      if ((p.status === "CANCELLED" || p.status === "EXPIRED") && filledQuantity >= p.quantity) fail("ORDER_FILL_STATUS_MISMATCH");
      if (p.filledQuantity !== undefined && p.filledQuantity !== filledQuantity) fail("ORDER_FILLED_QUANTITY_MISMATCH");
      if (p.remainingQuantity !== undefined && p.remainingQuantity !== p.quantity - filledQuantity) fail("ORDER_REMAINING_QUANTITY_MISMATCH");
    }
    const product = productOf(p);
    const next = { ...p, product, engine: event.engine, lastSequence: event.sequence };
    if (existing) {
      for (const field of ["assetClass", "instrumentKey", "side", "orderType", "quantity", "product"]) {
        if (existing[field] !== next[field]) fail("ORDER_IDENTITY_MUTATION");
      }
      Object.assign(existing, next);
    } else projection.orders.push(next);
    const autoReleaseOnTerminalSell = existing && p.side === "SELL" && p.assetClass !== "FUTURE" &&
      ["CANCELLED", "EXPIRED"].includes(p.status)
      ? -(existing.quantity - projection.fills.filter(fill => fill.orderId === p.orderId)
        .reduce((sum, fill) => sum + fill.quantity, 0))
      : 0;
    if (autoReleaseOnTerminalSell !== 0 && p.reservedQuantityDelta !== undefined &&
        p.reservedQuantityDelta !== autoReleaseOnTerminalSell) {
      fail("SELL_RESERVATION_RELEASE_MISMATCH");
    }
    const reservationDelta = autoReleaseOnTerminalSell !== 0
      ? autoReleaseOnTerminalSell
      : (p.reservedQuantityDelta ??
        (event.type === "ORDER_ACCEPTED" && p.side === "SELL" && p.assetClass !== "FUTURE" ? p.quantity : 0));
    if (reservationDelta !== 0) {
      const key = positionKey(p.assetClass, p.instrumentKey, product);
      const position = projection.positions.find(x => x.key === key);
      if (!position || (p.assetClass === "FUTURE") || position.quantity - position.reservedQuantity < reservationDelta) fail("DEMO_SHARE_RESERVATION_INVARIANT");
      position.reservedQuantity += reservationDelta;
      if (!integer(position.reservedQuantity) || position.reservedQuantity < 0 || position.reservedQuantity > position.quantity) fail("DEMO_SHARE_RESERVATION_INVARIANT");
    }
  }
  if (event.type === "FILL_RECORDED") {
    if (projection.fills.some(x => x.fillId === event.payload.fillId)) fail("DUPLICATE_FILL_ID");
    const p = event.payload, order = projection.orders.find(x => x.orderId === p.orderId);
    if (!order || order.engine !== event.engine || order.instrumentKey !== p.instrumentKey ||
        order.assetClass !== p.assetClass || order.side !== p.side || order.product !== productOf(p) ||
        ["CANCELLED", "REJECTED", "EXPIRED", "FILLED"].includes(order.status)) fail("FILL_ORDER_MISMATCH");
    const alreadyFilled = projection.fills.filter(x => x.orderId === p.orderId).reduce((sum, x) => sum + x.quantity, 0);
    if (!Number.isSafeInteger(alreadyFilled + p.quantity) || alreadyFilled + p.quantity > order.quantity) fail("FILL_QUANTITY_EXCEEDS_ORDER");
    if (p.side === "SELL" && p.assetClass !== "FUTURE") {
      const position = projection.positions.find(x => x.key === positionKey(p.assetClass, p.instrumentKey, productOf(p)));
      if (!position || position.reservedQuantity < p.quantity) fail("DEMO_SHARE_RESERVATION_INVARIANT");
      position.reservedQuantity -= p.quantity;
    }
    projection.fills.push({ ...p, product: productOf(p), engine: event.engine, sequence: event.sequence, occurredAt: event.occurredAt });
  }
  if (event.type === "POSITION_CHANGED") {
    const p = event.payload, product = productOf(p), key = positionKey(p.assetClass, p.instrumentKey, product);
    let position = projection.positions.find(x => x.key === key);
    if (!position) {
      position = { key, assetClass: p.assetClass, instrumentKey: p.instrumentKey, product, symbol: p.symbol, expiry: p.expiry, optionType: p.optionType, strikePaise: p.strikePaise, quantity: 0, reservedQuantity: 0, costBasisPaise: 0, averagePricePaise: 0, realizedPnlPaise: 0 };
      projection.positions.push(position);
    }
    const quantity = position.quantity + p.quantityDelta;
    const costBasis = position.costBasisPaise + (p.costBasisDeltaPaise ?? 0);
    const reserved = position.reservedQuantity + (p.reservedQuantityDelta ?? 0);
    const realized = position.realizedPnlPaise + p.realizedPnlDeltaPaise;
    if (![quantity, costBasis, reserved, realized].every(Number.isSafeInteger) ||
        (p.assetClass !== "FUTURE" && quantity < 0) || costBasis < 0 || reserved < 0 || reserved > Math.max(0, quantity) ||
        (quantity === 0 && costBasis !== 0) || (p.assetClass === "FUTURE" && reserved !== 0)) fail("DEMO_POSITION_INVARIANT");
    for (const field of ["symbol", "expiry", "optionType", "strikePaise"]) if (p[field] !== undefined) position[field] = p[field];
    position.quantity = quantity;
    position.costBasisPaise = costBasis;
    position.reservedQuantity = reserved;
    position.averagePricePaise = quantity !== 0 ? Math.round(costBasis / Math.abs(quantity)) : 0;
    position.realizedPnlPaise = realized;
  }
  projection.account.realizedPnlPaise += event.type === "POSITION_CHANGED" ? event.payload.realizedPnlDeltaPaise : 0;
  if (!Number.isSafeInteger(projection.account.realizedPnlPaise)) fail("DEMO_PNL_INVARIANT");
  projection.events.push(event);
}
export function createPaperDemoEventLedger(opening) {
  if (!object(opening)) fail("DEMO_OPENING_SNAPSHOT_REQUIRED");
  validateIdentity(opening.accountId, "ACCOUNT_ID");
  validateIdentity(opening.sessionId, "SESSION_ID");
  if (!integer(opening.cashBalancePaise) || opening.cashBalancePaise < 0 ||
      !integer(opening.blockedFundsPaise) || opening.blockedFundsPaise < 0 ||
      opening.blockedFundsPaise > opening.cashBalancePaise) fail("INVALID_DEMO_OPENING_CASH");
  const identity = { accountId: opening.accountId, sessionId: opening.sessionId };
  const projection = initialProjection(opening);
  const eventIds = new Map(), sourceEvents = new Map(), idempotency = new Map();
  let lastTimestamp = -Infinity;
  function append(input) {
    const candidate = { ...input, schemaVersion: input.schemaVersion === undefined ? VERSION : input.schemaVersion, sequence: projection.events.length + 1 };
    const event = validateEvent(candidate, identity, projection.events.length + 1);
    const fingerprint = JSON.stringify({ ...event, sequence: undefined });
    const prior = idempotency.get(event.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail("IDEMPOTENCY_KEY_REUSE_MISMATCH");
      return { accepted: false, duplicate: true, event: prior.event, snapshot: snapshot() };
    }
    if (eventIds.has(event.eventId)) fail("DUPLICATE_EVENT_ID");
    const sourceKey = event.engine + "|" + event.sourceEventId;
    if (sourceEvents.has(sourceKey)) fail("DUPLICATE_SOURCE_EVENT");
    const time = timestampMs(event.occurredAt);
    if (time <= lastTimestamp) fail("DEMO_EVENT_TIME_ORDER_MISMATCH");
    const before = clone(projection);
    try {
      apply(projection, event);
      lastTimestamp = time;
      eventIds.set(event.eventId, event);
      sourceEvents.set(sourceKey, event.eventId);
      idempotency.set(event.idempotencyKey, { fingerprint, event });
    } catch (error) {
      Object.keys(projection).forEach(key => delete projection[key]);
      Object.assign(projection, before);
      throw error;
    }
    return { accepted: true, duplicate: false, event, snapshot: snapshot() };
  }
  function snapshot() { return freeze(clone(projection)); }
  return Object.freeze({ append, snapshot });
}
export function replayPaperDemoEvents(opening, events) {
  if (!Array.isArray(events)) fail("DEMO_EVENT_ARRAY_REQUIRED");
  const ledger = createPaperDemoEventLedger(opening);
  events.forEach((event, index) => {
    if (event.schemaVersion !== VERSION) fail("UNSUPPORTED_EVENT_SCHEMA_VERSION");
    if (event.sequence !== index + 1) fail("DEMO_EVENT_SEQUENCE_MISMATCH");
    const { sequence, ...input } = event;
    const result = ledger.append(input);
    if (!result.accepted) fail("DUPLICATE_EVENT_IN_REPLAY");
  });
  return ledger.snapshot();
}
export const PAPER_DEMO_EVENT_SCHEMA_VERSION = VERSION;
