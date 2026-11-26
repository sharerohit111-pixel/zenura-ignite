"use strict";

function hasEncryptedTokenEnvelope(value) {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && value.v === 1
    && typeof value.iv === "string"
    && value.iv.length > 0
    && typeof value.tag === "string"
    && value.tag.length > 0
    && typeof value.data === "string"
    && value.data.length > 0;
}

function isUpstoxTokenUsable(data, now = Date.now()) {
  if (!data || data.status !== "connected" || !hasEncryptedTokenEnvelope(data.tokenCiphertext)) return false;
  if (!Number.isSafeInteger(now) || now < 0 || !data.expiresAt || typeof data.expiresAt.toMillis !== "function") return false;
  let expiresAt;
  try { expiresAt = data.expiresAt.toMillis(); } catch (_) { return false; }
  return Number.isSafeInteger(expiresAt) && expiresAt > now;
}

module.exports = {isUpstoxTokenUsable, hasEncryptedTokenEnvelope};
