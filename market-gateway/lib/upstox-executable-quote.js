"use strict";

const { evaluateDerivativeLimitQuote } = require("./derivative-limit-quote-policy");

function toSafeTimestamp(value) {
  if (!(typeof value === "string" || typeof value === "number") ||
      !/^\d{1,16}$/.test(String(value))) return null;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
}

function toPricePaise(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const paise = Math.round(value * 100);
  return Number.isSafeInteger(paise) && paise > 0 &&
    Math.abs(value * 100 - paise) < 1e-7 ? paise : null;
}

// Upstox V3 protobuf FeedResponse decoded with longs:String, oneofs:true.
// Use the feed-level currentTs as the timestamp for the bid/ask snapshot;
// LTPC.ltt is a trade timestamp and must not be substituted for quote time.
function extractUpstoxExecutableQuote(feedResponse, instrumentKey, {
  nowMs = Date.now(),
  maxAgeMs = 15000,
} = {}) {
  const fail = (message) => {
    throw Object.assign(new Error(message), { status: 409 });
  };
  if (!feedResponse || typeof feedResponse !== "object" ||
      !feedResponse.feeds || typeof feedResponse.feeds !== "object" ||
      Array.isArray(feedResponse.feeds) ||
      typeof instrumentKey !== "string" || !instrumentKey ||
      !Number.isSafeInteger(nowMs) || nowMs <= 0 ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) {
    fail("Invalid Upstox executable quote request.");
  }

  const timestampMs = toSafeTimestamp(feedResponse.currentTs);
  if (timestampMs === null || timestampMs > nowMs ||
      nowMs - timestampMs > maxAgeMs) {
    fail("Upstox bid/ask snapshot is missing, future-dated or stale.");
  }

  if (!Object.prototype.hasOwnProperty.call(feedResponse.feeds, instrumentKey)) {
    fail("Requested derivative instrument is missing from the Upstox feed.");
  }
  const feed = feedResponse.feeds[instrumentKey];
  if (!feed || typeof feed !== "object" || Array.isArray(feed)) {
    fail("Upstox derivative feed entry is malformed.");
  }

  const marketFeed = feed.fullFeed && feed.fullFeed.marketFF;
  const depth = marketFeed && marketFeed.marketLevel &&
    Array.isArray(marketFeed.marketLevel.bidAskQuote)
    ? marketFeed.marketLevel.bidAskQuote[0]
    : feed.firstLevelWithGreeks && feed.firstLevelWithGreeks.firstDepth;

  if (!depth || typeof depth !== "object" || Array.isArray(depth)) {
    fail("Upstox executable market depth is unavailable; LTP fallback is disabled.");
  }

  const bidPricePaise = toPricePaise(depth.bidP);
  const askPricePaise = toPricePaise(depth.askP);
  const bidQuantity = Number(depth.bidQ);
  const askQuantity = Number(depth.askQ);
  if (bidPricePaise !== null && askPricePaise !== null &&
      bidPricePaise > askPricePaise &&
      Number.isSafeInteger(bidQuantity) && bidQuantity > 0 &&
      Number.isSafeInteger(askQuantity) && askQuantity > 0) {
    fail("Upstox returned a crossed bid/ask book; executable quote rejected.");
  }
  return Object.freeze({
    instrumentKey,
    timestampMs,
    ageMs: nowMs - timestampMs,
    bidPricePaise: bidPricePaise !== null && Number.isSafeInteger(bidQuantity) && bidQuantity > 0
      ? bidPricePaise : null,
    askPricePaise: askPricePaise !== null && Number.isSafeInteger(askQuantity) && askQuantity > 0
      ? askPricePaise : null,
  });
}

function evaluateUpstoxDerivativeLimit(feedResponse, instrumentKey, {
  side,
  limitPricePaise,
  nowMs = Date.now(),
  maxAgeMs = 15000,
} = {}) {
  const quote = extractUpstoxExecutableQuote(feedResponse, instrumentKey, { nowMs, maxAgeMs });
  const result = evaluateDerivativeLimitQuote({
    side,
    limitPricePaise,
    bidPricePaise: quote.bidPricePaise,
    askPricePaise: quote.askPricePaise,
    quoteTimestampMs: quote.timestampMs,
    nowMs,
    maxQuoteAgeMs: maxAgeMs,
  });
  return Object.freeze({ ...result, instrumentKey, quoteTimestampMs: quote.timestampMs });
}

module.exports = { extractUpstoxExecutableQuote, evaluateUpstoxDerivativeLimit };
