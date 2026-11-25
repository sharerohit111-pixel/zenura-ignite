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
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) fail("INVALID_EVENT_TIMESTAMP");
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
    if (input.engine === "EQUITY" && p.assetClass !== "EQUITY") fail("ENGINE_ASSET_MISMATCH");
    if (input.engine === "FUTURES" && p.assetClass !== "FUTURE") fail("ENGINE_ASSET_MISMATCH");
    if (input.engine === "OPTIONS" && p.assetClass !== "OPTION") fail("ENGINE_ASSET_MISMATCH");
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
    const product = productOf(p);
    const next = { ...p, product, engine: event.engine, lastSequence: event.sequence };
    if (existing) {
      for (const field of ["assetClass", "instrumentKey", "side", "orderType", "quantity", "product"]) {
        if (existing[field] !== next[field]) fail("ORDER_IDENTITY_MUTATION");
      }
      Object.assign(existing, next);
    } else projection.orders.push(next);
    const reservationDelta = p.reservedQuantityDelta ?? (event.type === "ORDER_ACCEPTED" && p.side === "SELL" ? p.quantity : 0);
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
    if (time < lastTimestamp) fail("DEMO_EVENT_TIME_ORDER_MISMATCH");
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
    if (!object(event) || event.schemaVersion !== VERSION) fail("UNSUPPORTED_EVENT_SCHEMA_VERSION");
    if (event.sequence !== index + 1) fail("DEMO_EVENT_SEQUENCE_MISMATCH");
    const { sequence, ...input } = event;
    const result = ledger.append(input);
    if (!result.accepted) fail("DUPLICATE_EVENT_IN_REPLAY");
  });
  return ledger.snapshot();
}
export const PAPER_DEMO_EVENT_SCHEMA_VERSION = VERSION;
