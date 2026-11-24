"use strict";

const { normalizeUpstoxFeedQuotes } = require("./upstox-stream-normalizer");

function decodeFeedResponse(FeedResponse, bytes) {
  if (!FeedResponse || typeof FeedResponse.decode !== "function" || typeof FeedResponse.toObject !== "function")
    throw new TypeError("A valid Upstox FeedResponse protobuf type is required");
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array))
    throw new TypeError("Upstox feed payload must be binary");
  const message = FeedResponse.decode(bytes);
  return FeedResponse.toObject(message, { longs: String, enums: String, defaults: false, oneofs: true });
}

/**
 * Single binary-frame boundary for Upstox: protobuf decode followed by strict,
 * entitlement-bound provider-neutral quote normalization. No socket or network
 * lifecycle is owned here; callers supply the canonical native-key mapping.
 */
function decodeAndNormalizeUpstoxFeedResponse(FeedResponse, bytes, options = {}) {
  const decoded = decodeFeedResponse(FeedResponse, bytes);
  return normalizeUpstoxFeedQuotes(decoded, options);
}

module.exports = { decodeFeedResponse, decodeAndNormalizeUpstoxFeedResponse };
