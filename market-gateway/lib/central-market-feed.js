"use strict";

const { normalizeMarketDataSnapshot } = require("./market-data-provider-contract");

const MAX_INSTRUMENTS = 500;
const MAX_PENDING_EVENTS = 1000;
const INSTRUMENT_ID = /^[A-Za-z0-9:_|.-]{1,160}$/;

function fail(message, code = "central_feed_unavailable", status = 503) {
  throw Object.assign(new Error(message), { code, status });
}

function validateInstrumentList(instruments) {
  if (!Array.isArray(instruments) || instruments.length === 0 ||
      instruments.length > MAX_INSTRUMENTS) {
    throw new TypeError("A non-empty bounded central-feed instrument list is required.");
  }
  const seen = new Set();
  return Object.freeze(instruments.map((item) => {
    if (!item || typeof item !== "object" ||
        typeof item.instrumentId !== "string" || !INSTRUMENT_ID.test(item.instrumentId) ||
        !["NSE", "BSE"].includes(item.exchange) || seen.has(item.instrumentId)) {
      throw new TypeError("Central-feed instrument identity is invalid or duplicated.");
    }
    seen.add(item.instrumentId);
    return Object.freeze({ instrumentId: item.instrumentId, exchange: item.exchange });
  }));
}

function validEntitlement(value) {
  return !!value && value.approved === true &&
    value.paperTradingAllowed === true &&
    value.redistributionAllowed === true &&
    typeof value.reference === "string" && value.reference.trim().length > 0 &&
    typeof value.rightsApprovalReference === "string" && value.rightsApprovalReference.trim().length > 0 &&
    typeof value.regulatoryApprovalReference === "string" && value.regulatoryApprovalReference.trim().length > 0;
}

function createCentralMarketFeed({
  provider,
  instruments,
  transport,
  assertRightsApproved,
  resolveProviderEntitlement,
  clock = () => Date.now(),
  maxPendingEvents = MAX_PENDING_EVENTS,
  onStatus = () => {},
}) {
  const selected = validateInstrumentList(instruments);
  if (!provider || typeof provider.providerId !== "string" ||
      typeof provider.getHealth !== "function" || typeof provider.openStream !== "function") {
    throw new TypeError("Central feed source must expose providerId, getHealth() and openStream().");
  }
  if (!transport || typeof transport.publish !== "function") {
    throw new TypeError("Central feed transport must expose publish(channel, event).");
  }
  if (typeof assertRightsApproved !== "function" ||
      typeof resolveProviderEntitlement !== "function" ||
      typeof clock !== "function" || typeof onStatus !== "function" ||
      !Number.isSafeInteger(maxPendingEvents) || maxPendingEvents < 1 ||
      maxPendingEvents > MAX_PENDING_EVENTS) {
    throw new TypeError("Central feed dependencies or queue bound are invalid.");
  }

  const allowed = new Map(selected.map((item) => [item.instrumentId, item.exchange]));
  let state = "idle";
  let stream = null;
  let pending = 0;
  let generation = 0;
  let lastEventAtMs = null;
  let lastErrorCode = null;
  const lastSequence = new Map();

  function status(next, code = null) {
    state = next;
    lastErrorCode = code;
    onStatus(Object.freeze({
      state,
      providerId: provider.providerId,
      instrumentCount: selected.length,
      pendingEvents: pending,
      lastEventAtMs,
      errorCode: lastErrorCode,
    }));
  }

  async function processEvent(input, runId) {
    if (state !== "running" || runId !== generation) return false;
    if (pending >= maxPendingEvents) {
      status("degraded", "central_feed_backpressure");
      fail("Central feed queue is full; event was not published.", "central_feed_backpressure", 503);
    }
    pending += 1;
    try {
      assertRightsApproved();
      if (!input || typeof input !== "object" || input.providerId !== provider.providerId) {
        fail("Central feed event provider attribution mismatch.", "invalid_market_data", 409);
      }
      const exchange = allowed.get(input.instrumentId);
      if (!exchange || input.exchange !== exchange) {
        fail("Central feed event instrument is not in the approved subscription set.", "invalid_market_data", 409);
      }
      const entitlement = await resolveProviderEntitlement({
        providerId: provider.providerId,
        instrumentId: input.instrumentId,
        exchange,
      });
      if (!validEntitlement(entitlement)) {
        fail("Central feed provider entitlement is missing or not approved.", "market_data_entitlement_denied", 403);
      }
      const event = normalizeMarketDataSnapshot(input, {
        expectedProviderId: provider.providerId,
        expectedInstrumentId: input.instrumentId,
        nowMs: clock(),
      });
      const previous = lastSequence.get(event.instrumentId);
      if (previous && previous === event.sourceSequence) {
        fail("Duplicate market-data source sequence rejected.", "duplicate_market_data_event", 409);
      }
      if (state !== "running" || runId !== generation) return false;
      const channel = "s-trade:market-data:" + encodeURIComponent(event.instrumentId);
      await transport.publish(channel, Object.freeze({
        ...event,
        entitlementReference: entitlement.reference,
        rightsApprovalReference: entitlement.rightsApprovalReference,
        regulatoryApprovalReference: entitlement.regulatoryApprovalReference,
      }));
      lastSequence.set(event.instrumentId, event.sourceSequence);
      lastEventAtMs = clock();
      return true;
    } catch (error) {
      if (error && error.code === "market_data_rights_not_approved") status("blocked", error.code);
      else if (error && error.code === "market_data_entitlement_denied") status("blocked", error.code);
      throw error;
    } finally {
      pending = Math.max(0, pending - 1);
    }
  }

  async function start() {
    if (state !== "idle") fail("Central feed can only be started once per instance.", "central_feed_invalid_state", 409);
    const runId = ++generation;
    status("starting");
    try {
      assertRightsApproved();
      const health = await provider.getHealth();
      if (!health || health.healthy !== true) fail("Central feed provider health check failed.", "provider_unavailable");
      for (const item of selected) {
        assertRightsApproved();
        const entitlement = await resolveProviderEntitlement({
          providerId: provider.providerId,
          instrumentId: item.instrumentId,
          exchange: item.exchange,
        });
        if (!validEntitlement(entitlement)) {
          fail("Central feed provider entitlement is missing for " + item.instrumentId + ".", "market_data_entitlement_denied", 403);
        }
      }
      stream = await provider.openStream({
        instruments: selected,
        onEvent: (event) => processEvent(event, runId),
        onError: (error) => {
          if (state === "running" && runId === generation) {
            status("degraded", error && typeof error.code === "string" ? error.code : "provider_stream_error");
          }
        },
      });
      if (!stream || typeof stream.close !== "function") {
        fail("Central feed provider did not return a closable stream.", "invalid_provider_stream", 502);
      }
      if (runId !== generation) {
        await stream.close();
        stream = null;
        return false;
      }
      status("running");
      return true;
    } catch (error) {
      if (stream && typeof stream.close === "function") {
        try { await stream.close(); } catch (_) {}
      }
      stream = null;
      status("blocked", error && typeof error.code === "string" ? error.code : "central_feed_start_failed");
      throw error;
    }
  }

  async function stop() {
    if (state === "stopped") return false;
    generation += 1;
    const current = stream;
    stream = null;
    status("stopped");
    if (current) await current.close();
    return true;
  }

  function getStatus() {
    return Object.freeze({
      state,
      providerId: provider.providerId,
      instrumentCount: selected.length,
      pendingEvents: pending,
      lastEventAtMs,
      errorCode: lastErrorCode,
    });
  }

  return Object.freeze({ start, stop, getStatus });
}

module.exports = {
  MAX_INSTRUMENTS,
  MAX_PENDING_EVENTS,
  createCentralMarketFeed,
  validateInstrumentList,
  validEntitlement,
};
