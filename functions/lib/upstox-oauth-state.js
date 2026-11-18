"use strict";

// OAuth state is valid only for its owning user, once, and before its deadline.
function isOAuthStateUsable(data, now = Date.now()) {
  if (!data || typeof data.uid !== "string" || data.uid.length === 0 || data.used !== false) return false;
  const expiresAt = data.expiresAt && typeof data.expiresAt.toMillis === "function"
    ? data.expiresAt.toMillis() : NaN;
  return Number.isFinite(expiresAt) && expiresAt > now;
}

module.exports = {isOAuthStateUsable};
