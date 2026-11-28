"use strict";

const CHANNEL_PREFIX = "s-trade:market-data:";
const CHANNEL_PATTERN = CHANNEL_PREFIX + "*";
const DEFAULT_MAX_MESSAGE_BYTES = 64 * 1024;
const INSTRUMENT_ID = /^[A-Za-z0-9:_|.-]{1,160}$/;

function invalid(message, code = "invalid_market_feed_message") {
  throw Object.assign(new Error(message), { code, status: 400 });
}

function parseChannel(channel) {
  if (typeof channel !== "string" || !channel.startsWith(CHANNEL_PREFIX) || channel.length > 256) {
    invalid("Redis market-feed channel is invalid.");
  }
  const encoded = channel.slice(CHANNEL_PREFIX.length);
  if (!encoded || encoded.includes("*")) invalid("Redis market-feed channel instrument is invalid.");
  let instrumentId;
  try { instrumentId = decodeURIComponent(encoded); }
  catch (_) { invalid("Redis market-feed channel encoding is invalid."); }
  if (!INSTRUMENT_ID.test(instrumentId)) invalid("Redis market-feed instrument ID is invalid.");
  return instrumentId;
}

function createRedisMarketFeedSubscriber({
  subscriber,
  fanout,
  maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES,
  onError = () => {},
}) {
  if (!subscriber || typeof subscriber.pSubscribe !== "function" ||
      typeof subscriber.pUnsubscribe !== "function" ||
      !fanout || typeof fanout.dispatch !== "function" ||
      !Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 256 ||
      maxMessageBytes > 1024 * 1024 || typeof onError !== "function") {
    throw new TypeError("Redis subscriber dependencies or bounds are invalid.");
  }

  let state = "idle";
  let callback = null;
  let subscriptionPromise = null;
  let inFlight = Promise.resolve();
  let accepted = 0;
  let rejected = 0;

  async function handleMessage(message, channel) {
    try {
      if (state !== "running") return false;
      if (typeof message !== "string" || Buffer.byteLength(message, "utf8") > maxMessageBytes) {
        invalid("Redis market-feed message is oversized or not text.", "market_feed_payload_too_large");
      }
      const instrumentId = parseChannel(channel);
      let event;
      try { event = JSON.parse(message); }
      catch (_) { invalid("Redis market-feed payload is not valid JSON."); }
      if (!event || typeof event !== "object" || Array.isArray(event) ||
          event.instrumentId !== instrumentId) {
        invalid("Redis channel and event instrument identity do not match.");
      }
      const delivered = await fanout.dispatch(event);
      accepted += 1;
      return delivered;
    } catch (error) {
      rejected += 1;
      try { onError(error); } catch (_) {}
      return false;
    }
  }

  async function start() {
    if (state !== "idle") {
      throw Object.assign(new Error("Redis market-feed subscriber can only start once."), {
        code: "market_feed_subscriber_invalid_state", status: 409,
      });
    }
    state = "starting";
    callback = (message, channel) => {
      inFlight = inFlight.then(() => handleMessage(message, channel));
      return inFlight;
    };
    subscriptionPromise = Promise.resolve().then(() =>
      subscriber.pSubscribe(CHANNEL_PATTERN, callback));
    try {
      await subscriptionPromise;
      if (state !== "starting") return false;
      state = "running";
      return true;
    } catch (error) {
      if (state !== "stopped") state = "blocked";
      callback = null;
      throw error;
    }
  }

  async function stop() {
    if (state === "stopped") return false;
    const previous = state;
    state = "stopped";
    if (previous === "running" || previous === "starting") {
      if (subscriptionPromise) await subscriptionPromise.catch(() => {});
      if (previous === "running" || subscriptionPromise) {
        try { await subscriber.pUnsubscribe(CHANNEL_PATTERN); }
        finally { await inFlight; }
      }
    }
    callback = null;
    return true;
  }

  function getStatus() {
    return Object.freeze({ state, accepted, rejected });
  }

  return Object.freeze({ start, stop, getStatus });
}

module.exports = {
  CHANNEL_PREFIX, CHANNEL_PATTERN, DEFAULT_MAX_MESSAGE_BYTES,
  parseChannel, createRedisMarketFeedSubscriber,
};
