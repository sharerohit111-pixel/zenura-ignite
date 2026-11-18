"use strict";

function isUpstoxTokenUsable(data, now = Date.now()) {
  if (!data || data.status !== "connected" || typeof data.tokenCiphertext !== "string" || data.tokenCiphertext.length === 0) return false;
  if (!Number.isSafeInteger(now) || now < 0 || !data.expiresAt || typeof data.expiresAt.toMillis !== "function") return false;
  let expiresAt;
  try { expiresAt = data.expiresAt.toMillis(); } catch (_) { return false; }
  return Number.isSafeInteger(expiresAt) && expiresAt > now;
}

module.exports = {isUpstoxTokenUsable};
