"use strict";

const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const CHANNEL_PREFIX = "s-trade:market-data:";

function createRedisMarketFeedTransport({
  publisher,
  maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
}) {
  if (!publisher || typeof publisher.publish !== "function") {
    throw new TypeError("Redis publisher client with publish() is required.");
  }
  if (!Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 256 ||
      maxPayloadBytes > 1024 * 1024) {
    throw new TypeError("Redis market-feed payload bound is invalid.");
  }

  let closed = false;

  async function publish(channel, event) {
    if (closed) {
      throw Object.assign(new Error("Redis market-feed transport is closed."), {
        code: "market_feed_transport_closed",
        status: 503,
      });
    }
    if (typeof channel !== "string" || !channel.startsWith(CHANNEL_PREFIX) ||
        channel.length > 256 || !event || typeof event !== "object" || Array.isArray(event)) {
      throw Object.assign(new Error("Redis market-feed channel or event is invalid."), {
        code: "invalid_market_feed_message",
        status: 400,
      });
    }
    let payload;
    try {
      payload = JSON.stringify(event);
    } catch (_) {
      throw Object.assign(new Error("Redis market-feed event could not be serialized."), {
        code: "invalid_market_feed_message",
        status: 400,
      });
    }
    if (Buffer.byteLength(payload, "utf8") > maxPayloadBytes) {
      throw Object.assign(new Error("Redis market-feed event exceeds the configured payload bound."), {
        code: "market_feed_payload_too_large",
        status: 413,
      });
    }
    return publisher.publish(channel, payload);
  }

  async function close() {
    closed = true;
  }

  return Object.freeze({ publish, close });
}

module.exports = { createRedisMarketFeedTransport, DEFAULT_MAX_PAYLOAD_BYTES };
