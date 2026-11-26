"use strict";

function connectionStatus(data, now = Date.now()) {
  if (!data) return {connected:false,feedReady:false,status:"not_connected",expiresAt:null};
  let expiry = null;
  try {
    expiry = data.expiresAt && typeof data.expiresAt.toMillis === "function"
      ? data.expiresAt.toMillis() : null;
  } catch (_) {
    expiry = null;
  }
  const validClock = Number.isSafeInteger(now) && now >= 0;
  const valid = validClock && data.status === "connected"
    && Number.isSafeInteger(expiry) && expiry > now;
  return {
    connected:valid,
    feedReady:false,
    status:valid ? "authorized_feed_not_configured" : data.status === "connected" ? "token_expired" : "not_connected",
    expiresAt:Number.isSafeInteger(expiry) ? expiry : null
  };
}

module.exports = {connectionStatus};
