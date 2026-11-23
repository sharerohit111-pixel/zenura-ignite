"use strict";

const DEFAULT_EXPIRY_SAFETY_BUFFER_MS = 60_000;

function isUpstoxAccessTokenUsable(expiresAtMs, nowMs = Date.now(), safetyBufferMs = DEFAULT_EXPIRY_SAFETY_BUFFER_MS) {
  return Number.isSafeInteger(expiresAtMs) && expiresAtMs > 0
    && Number.isSafeInteger(nowMs) && nowMs >= 0
    && Number.isSafeInteger(safetyBufferMs) && safetyBufferMs >= 0
    && expiresAtMs > nowMs + safetyBufferMs;
}

module.exports = {isUpstoxAccessTokenUsable, DEFAULT_EXPIRY_SAFETY_BUFFER_MS};
