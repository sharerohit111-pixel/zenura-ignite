"use strict";

// OAuth state is valid only for its owning user, once, and before its deadline.
function isOAuthStateUsable(data, now = Date.now()) {
  if (!data || typeof data.uid !== "string" || data.uid.length === 0 || data.used !== false
    || !Number.isSafeInteger(now) || now < 0
    || !data.expiresAt || typeof data.expiresAt.toMillis !== "function") return false;
  let expiresAt;
  try { expiresAt = data.expiresAt.toMillis(); } catch (_) { return false; }
  return Number.isSafeInteger(expiresAt) && expiresAt > now;
}

module.exports = {isOAuthStateUsable};
