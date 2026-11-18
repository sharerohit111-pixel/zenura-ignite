"use strict";

function connectionStatus(data, now = Date.now()) {
  if (!data) return {connected:false,feedReady:false,status:"not_connected",expiresAt:null};
  const expiry = data.expiresAt && typeof data.expiresAt.toMillis === "function"
    ? data.expiresAt.toMillis() : null;
  const valid = data.status === "connected" && Number.isFinite(expiry) && expiry > now;
  return {
    connected:valid,
    feedReady:false,
    status:valid ? "authorized_feed_not_configured" : data.status === "connected" ? "token_expired" : "not_connected",
    expiresAt:expiry
  };
}

module.exports = {connectionStatus};
