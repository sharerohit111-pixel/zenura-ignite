"use strict";

const MAX_CONNECTIONS = 1000;
const MAX_INSTRUMENTS_PER_CONNECTION = 50;
const INSTRUMENT_ID = /^[A-Za-z0-9:_|.-]{1,160}$/;

function denied(message, code = "market_feed_subscription_denied", status = 403) {
  throw Object.assign(new Error(message), { code, status });
}

function validPrincipal(value) {
  return !!value && typeof value.userId === "string" &&
    value.userId.trim().length > 0 && value.userId.length <= 160 &&
    typeof value.tenantId === "string" && value.tenantId.trim().length > 0 &&
    value.tenantId.length <= 160;
}

function createAuthenticatedMarketFeedFanout({
  authenticate,
  authorizeInstrument,
  maxConnections = MAX_CONNECTIONS,
  maxInstrumentsPerConnection = MAX_INSTRUMENTS_PER_CONNECTION,
}) {
  if (typeof authenticate !== "function" || typeof authorizeInstrument !== "function" ||
      !Number.isSafeInteger(maxConnections) || maxConnections < 1 ||
      maxConnections > MAX_CONNECTIONS ||
      !Number.isSafeInteger(maxInstrumentsPerConnection) ||
      maxInstrumentsPerConnection < 1 ||
      maxInstrumentsPerConnection > MAX_INSTRUMENTS_PER_CONNECTION) {
    throw new TypeError("Market-feed fanout dependencies or bounds are invalid.");
  }

  const connections = new Map();
  let nextConnectionId = 1;
  let closed = false;

  function remove(connectionId) {
    const entry = connections.get(connectionId);
    if (!entry) return false;
    connections.delete(connectionId);
    entry.instruments.clear();
    return true;
  }

  async function subscribe({ credential, send, instruments }) {
    if (closed) denied("Market-feed fanout is closed.", "market_feed_fanout_closed", 503);
    if (connections.size >= maxConnections) {
      denied("Market-feed connection capacity has been reached.", "market_feed_capacity", 503);
    }
    if (typeof send !== "function" || !Array.isArray(instruments) ||
        instruments.length === 0 || instruments.length > maxInstrumentsPerConnection) {
      throw new TypeError("A send callback and bounded non-empty instrument list are required.");
    }

    const requested = [...new Set(instruments)];
    if (requested.length !== instruments.length ||
        requested.some((id) => typeof id !== "string" || !INSTRUMENT_ID.test(id))) {
      throw new TypeError("Instrument subscription list is invalid or duplicated.");
    }

    const principal = await authenticate(credential);
    if (!validPrincipal(principal)) denied("Authenticated principal is invalid.", "market_feed_authentication_failed", 401);

    const approved = new Set();
    for (const instrumentId of requested) {
      const decision = await authorizeInstrument({
        principal: Object.freeze({ userId: principal.userId, tenantId: principal.tenantId }),
        instrumentId,
      });
      if (!decision || decision.allowed !== true ||
          typeof decision.entitlementReference !== "string" ||
          !decision.entitlementReference.trim()) {
        denied("Instrument subscription is not authorized.", "market_feed_subscription_denied", 403);
      }
      approved.add(instrumentId);
    }

    if (closed) denied("Market-feed fanout is closed.", "market_feed_fanout_closed", 503);
    if (connections.size >= maxConnections) {
      denied("Market-feed connection capacity has been reached.", "market_feed_capacity", 503);
    }

    const connectionId = String(nextConnectionId++);
    const entry = {
      principal: Object.freeze({ userId: principal.userId, tenantId: principal.tenantId }),
      instruments: approved,
      send,
    };
    connections.set(connectionId, entry);
    let active = true;

    return Object.freeze({
      connectionId,
      unsubscribe() {
        if (!active) return false;
        active = false;
        return remove(connectionId);
      },
    });
  }

  async function dispatch(event) {
    if (closed || !event || typeof event !== "object" ||
        typeof event.instrumentId !== "string" || !INSTRUMENT_ID.test(event.instrumentId)) return 0;
    let delivered = 0;
    const targets = [...connections.entries()].filter(([, entry]) =>
      entry.instruments.has(event.instrumentId));
    for (const [connectionId, entry] of targets) {
      if (connections.get(connectionId) !== entry) continue;
      try {
        await entry.send(event);
        delivered += 1;
      } catch (_) {
        remove(connectionId);
      }
    }
    return delivered;
  }

  function revokePrincipal({ userId, tenantId }) {
    if (typeof userId !== "string" || typeof tenantId !== "string") {
      throw new TypeError("Both userId and tenantId are required for revocation.");
    }
    let removed = 0;
    for (const [connectionId, entry] of connections) {
      if (entry.principal.userId === userId && entry.principal.tenantId === tenantId) {
        remove(connectionId);
        removed += 1;
      }
    }
    return removed;
  }

  function getStatus() {
    return Object.freeze({ closed, connectionCount: connections.size });
  }

  function close() {
    if (closed) return false;
    closed = true;
    connections.clear();
    return true;
  }

  return Object.freeze({ subscribe, dispatch, revokePrincipal, getStatus, close });
}

module.exports = {
  MAX_CONNECTIONS,
  MAX_INSTRUMENTS_PER_CONNECTION,
  createAuthenticatedMarketFeedFanout,
};
