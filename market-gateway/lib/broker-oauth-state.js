"use strict";
const crypto = require("node:crypto");
const TTL_MS = 10 * 60 * 1000;
function encode(value) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function sign(value, secret) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) throw new TypeError("BROKER_OAUTH_STATE_SECRET must contain at least 32 bytes.");
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}
function createBrokerOAuthState({ brokerId, userId, secret, now = Date.now(), nonce = crypto.randomBytes(24).toString("base64url") }) {
  if (!/^(upstox|fyers)$/.test(brokerId) || typeof userId !== "string" || !userId.trim() || userId.length > 128) throw new TypeError("Broker OAuth identity is invalid.");
  if (!Number.isSafeInteger(now) || now < 0 || typeof nonce !== "string" || nonce.length < 24) throw new TypeError("OAuth state parameters are invalid.");
  const payload = encode({ v: 1, brokerId, userId, iat: now, exp: now + TTL_MS, nonce });
  return payload + "." + sign(payload, secret);
}
function verifyBrokerOAuthState(state, { brokerId, userId, secret, now = Date.now() } = {}) {
  if (typeof state !== "string" || state.length > 2048 || !Number.isSafeInteger(now)) return null;
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  let expected;
  try { expected = sign(parts[0], secret); } catch (_) { return null; }
  const a = Buffer.from(parts[1]), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch (_) { return null; }
  if (!payload || payload.v !== 1 || payload.brokerId !== brokerId || payload.userId !== userId ||
      !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
      payload.exp <= now || payload.iat > now + 30 || payload.exp - payload.iat !== TTL_MS ||
      typeof payload.nonce !== "string" || payload.nonce.length < 24) return null;
  return Object.freeze({ brokerId: payload.brokerId, userId: payload.userId, issuedAt: payload.iat, expiresAt: payload.exp, nonce: payload.nonce });
}
module.exports = { TTL_MS, createBrokerOAuthState, verifyBrokerOAuthState };
