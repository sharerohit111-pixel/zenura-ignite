"use strict";

const { normalizeUpstoxFeedQuotes } = require("./upstox-stream-normalizer");

function fail(message, code = "invalid_market_data") {
  throw Object.assign(new Error(message), { status: 409, code });
}

/**
 * Per-WebSocket-session Upstox V3 frame-order coordinator.
 *
 * V3 sends market_info first, then an initial market snapshot, then live
 * updates. This coordinator deliberately does not open sockets, schedule
 * reconnects, or authorize providers. The caller must discard the session
 * on socket close/error and create a fresh coordinator for the next session.
 *
 * A session is not ready for trading until at least one mapped, fresh quote
 * has passed the supplied normalizer after market_info was received.
 */
function createUpstoxStreamSession({
  instrumentMap,
  now = () => Date.now(),
  maxAgeMs = 15000,
  normalizeQuotes = (frame, options) => normalizeUpstoxFeedQuotes(frame, options),
} = {}) {
  if (typeof normalizeQuotes !== "function" || typeof now !== "function" ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) {
    throw new TypeError("Upstox stream session requires a valid normalizer, clock and freshness policy.");
  }

  let phase = "awaiting_market_info";
  let marketInfoTimestampMs = null;
  let acceptedSnapshotQuotes = 0;

  function processFrame(frame, options) {
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
      fail("Upstox stream session received a malformed frame.");
    }

    if (frame.type === "market_info") {
      if (phase !== "awaiting_market_info") {
        fail("Upstox market-info frame arrived out of protocol order.", "stream_protocol_order");
      }
      const timestamp = Number(frame.currentTs);
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0 ||
          !frame.marketInfo || typeof frame.marketInfo !== "object" ||
          Array.isArray(frame.marketInfo) ||
          !frame.marketInfo.segmentStatus ||
          typeof frame.marketInfo.segmentStatus !== "object" ||
          Array.isArray(frame.marketInfo.segmentStatus)) {
        fail("Upstox market-info control frame is malformed.");
      }
      marketInfoTimestampMs = timestamp;
      phase = "awaiting_initial_snapshot";
      return Object.freeze({
        kind: "market_info",
        ready: false,
        quotes: Object.freeze([]),
        marketInfoTimestampMs,
      });
    }

    if (phase === "awaiting_market_info") {
      fail("Upstox feed data arrived before market_info.", "stream_protocol_order");
    }
    if (!frame.feeds || typeof frame.feeds !== "object" || Array.isArray(frame.feeds)) {
      fail("Upstox stream session received an invalid feed frame.");
    }

    const quotes = normalizeQuotes(frame, {
      ...options,
      instrumentMap,
      now: now(),
      maxAgeMs,
    });
    if (!Array.isArray(quotes)) {
      fail("Upstox quote normalizer returned an invalid result.");
    }

    if (phase === "awaiting_initial_snapshot") {
      // An empty result can mean stale data, unmapped keys or no valid prices.
      // Never mark the stream ready until at least one valid quote is accepted.
      if (quotes.length === 0) {
        return Object.freeze({
          kind: "awaiting_initial_snapshot",
          ready: false,
          quotes: Object.freeze([]),
          marketInfoTimestampMs,
        });
      }
      acceptedSnapshotQuotes = quotes.length;
      phase = "live";
      return Object.freeze({
        kind: "initial_snapshot",
        ready: true,
        quotes: Object.freeze([...quotes]),
        acceptedSnapshotQuotes,
        marketInfoTimestampMs,
      });
    }

    return Object.freeze({
      kind: "live_update",
      ready: true,
      quotes: Object.freeze([...quotes]),
      acceptedSnapshotQuotes,
      marketInfoTimestampMs,
    });
  }

  return Object.freeze({
    processFrame,
    getState() {
      return Object.freeze({
        phase,
        ready: phase === "live",
        marketInfoTimestampMs,
        acceptedSnapshotQuotes,
      });
    },
  });
}

module.exports = { createUpstoxStreamSession };
