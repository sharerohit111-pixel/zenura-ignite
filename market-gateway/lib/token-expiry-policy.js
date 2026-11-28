"use strict";

const IST_OFFSET_MINUTES = 330;
const PROVIDER_TOKEN_POLICIES = Object.freeze({
  upstox: Object.freeze({
    accessExpiry: "next_day_0330_ist",
    refreshStrategy: "not_assumed",
    reconnectMode: "oauth_authorization",
  }),
  fyers: Object.freeze({
    accessExpiry: "daily_0630_ist",
    refreshStrategy: "refresh_token_if_provider_grants",
    refreshValidityDays: 15,
    reconnectMode: "refresh_then_oauth_fallback",
  }),
  angel_one: Object.freeze({
    accessExpiry: "provider_response_required",
    refreshStrategy: "provider_response_required",
    reconnectMode: "provider_auth_flow",
  }),
  kotak_neo: Object.freeze({
    accessExpiry: "provider_response_or_session",
    refreshStrategy: "interactive_totp_session",
    reconnectMode: "totp_mpin",
  }),
});

function istParts(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
  };
}

function nextIstClockExpiry(now, hour, minute) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("A valid current date is required.");
  }
  const p = istParts(now);
  let target = Date.UTC(p.year, p.month, p.day, hour, minute, 0, 0);
  const currentWallClock = Date.UTC(p.year, p.month, p.day, p.hour, p.minute, p.second, p.millisecond);
  if (target <= currentWallClock) target += 24 * 60 * 60 * 1000;
  return new Date(target - IST_OFFSET_MINUTES * 60_000);
}

function calculateKnownAccessExpiry(providerId, now = new Date()) {
  if (providerId === "upstox") return nextIstClockExpiry(now, 3, 30);
  if (providerId === "fyers") return nextIstClockExpiry(now, 6, 30);
  return null;
}

function resolveTokenExpiry({ providerId, expiresAt, now = new Date() } = {}) {
  if (!PROVIDER_TOKEN_POLICIES[providerId]) {
    throw new TypeError("Unsupported broker token policy.");
  }
  if (expiresAt !== undefined && expiresAt !== null) {
    const parsed = typeof expiresAt === "number" ? new Date(expiresAt) : new Date(expiresAt);
    if (!Number.isFinite(parsed.getTime())) {
      throw new TypeError("Provider expiry timestamp is invalid.");
    }
    return parsed;
  }
  return calculateKnownAccessExpiry(providerId, now);
}

function getConnectionState({ providerId, expiresAt, now = new Date(), connected = true } = {}) {
  if (!PROVIDER_TOKEN_POLICIES[providerId]) {
    throw new TypeError("Unsupported broker token policy.");
  }
  if (!connected) {
    return Object.freeze({ status: "disconnected", action: "connect_broker" });
  }
  const expiry = resolveTokenExpiry({ providerId, expiresAt, now });
  if (!expiry) {
    return Object.freeze({
      status: "expiry_unknown",
      action: "verify_provider_session",
      reconnectMode: PROVIDER_TOKEN_POLICIES[providerId].reconnectMode,
    });
  }
  if (expiry.getTime() <= now.getTime()) {
    return Object.freeze({
      status: "expired",
      action: "reconnect_broker",
      reconnectMode: PROVIDER_TOKEN_POLICIES[providerId].reconnectMode,
    });
  }
  return Object.freeze({
    status: "connected",
    action: "none",
    expiresAt: expiry.toISOString(),
    reconnectMode: PROVIDER_TOKEN_POLICIES[providerId].reconnectMode,
  });
}

function getReconnectPresentation({ brokerName, hasAnyBroker = true } = {}) {
  if (!hasAnyBroker) {
    return Object.freeze({
      primaryAction: "continue_demo_replay",
      title: "Continue in Demo / Replay Mode",
      message: "No broker is connected. You can keep using S-TRADE in Demo / Replay Mode.",
    });
  }
  return Object.freeze({
    primaryAction: "one_click_reconnect",
    title: "Reconnect " + (brokerName || "broker"),
    message: "Your broker session has expired. Reconnect securely to resume today's broker-linked data.",
  });
}

module.exports = {
  IST_OFFSET_MINUTES,
  PROVIDER_TOKEN_POLICIES,
  calculateKnownAccessExpiry,
  resolveTokenExpiry,
  getConnectionState,
  getReconnectPresentation,
};
