"use strict";

const express = require("express");
const net = require("node:net");
const { encryptUpstoxToken, decryptUpstoxToken } = require("./upstox-token-crypto");

const LOGIN_URL = "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword";
const LOGOUT_URL = "https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/logout";

function nextAngelOneSessionExpiry(now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("Invalid session issue time.");
  // SmartAPI's published session guidance states JWT sessions remain valid until
  // 05:00 IST on the subsequent day, unless logged out or invalidated earlier.
  const local = new Date(now + 330 * 60 * 1000);
  const nextFiveAm = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 5, 0, 0, 0) - 330 * 60 * 1000;
  return new Date(nextFiveAm);
}

function validateAngelOneCredentials(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { clientcode, pin, totp } = body;
  if (Object.keys(body).some(key => !["clientcode", "pin", "totp"].includes(key))) return null;
  if (typeof clientcode !== "string" || !/^[A-Za-z0-9]{4,20}$/.test(clientcode)
    || typeof pin !== "string" || !/^\d{4,6}$/.test(pin)
    || typeof totp !== "string" || !/^\d{6}$/.test(totp)) return null;
  return { clientcode, pin, totp };
}

function isValidAngelOneLogin(payload) {
  return !!payload && payload.status === true && payload.data
    && typeof payload.data.jwtToken === "string" && payload.data.jwtToken.length > 0
    && typeof payload.data.refreshToken === "string" && payload.data.refreshToken.length > 0
    && typeof payload.data.feedToken === "string" && payload.data.feedToken.length > 0;
}

function createAngelOneRouter({ auth, serviceDb, fetchProvider, readProviderJson, encryptionKey,
  apiKey, clientLocalIp, clientPublicIp, macAddress, sourceId, logger = console }) {
  const router = express.Router();
  function headers() {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-PrivateKey": apiKey,
      "X-ClientLocalIP": clientLocalIp,
      "X-ClientPublicIP": clientPublicIp,
      "X-MACAddress": macAddress,
      "X-UserType": "USER",
      "X-SourceID": sourceId
    };
  }

  router.post("/session", async (req, res) => {
    try {
      const { user } = await auth(req);
      if (!user.emailConfirmedAt) return res.status(403).json({ error: "Verify your Supabase email before connecting Angel One." });
      if (!apiKey || !encryptionKey || net.isIP(clientLocalIp) !== 4 || net.isIP(clientPublicIp) !== 4 || !/^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(macAddress) || !["WEB", "MOBILE"].includes(sourceId)) return res.status(503).json({ error: "Angel One server configuration is incomplete. Configure API key, encryption key, local/public IPv4, MAC address and source ID." });
      const credentials = validateAngelOneCredentials(req.body);
      if (!credentials) return res.status(400).json({ error: "Enter a valid Client ID, 4–6 digit PIN and current 6-digit TOTP." });
      // Remove sensitive values from the parsed request object before any awaited work.
      if (req.body && typeof req.body === "object") { req.body.pin = ""; req.body.totp = ""; }
      const { data: rateRows, error: rateError } = await serviceDb.rpc("reserve_angel_one_login_attempt", { p_user_id: user.id });
      const rate = Array.isArray(rateRows) ? rateRows[0] : rateRows;
      if (rateError || !rate) {
        credentials.pin = ""; credentials.totp = "";
        return res.status(503).json({ error: "Angel One login protection is temporarily unavailable." });
      }
      if (!rate.allowed) {
        credentials.pin = ""; credentials.totp = "";
        return res.status(429).set("Retry-After", String(rate.retry_after_seconds || 1))
          .json({ error: "Too many Angel One login attempts. Wait before trying again." });
      }

      let providerResponse, payload;
      try {
        providerResponse = await fetchProvider(LOGIN_URL, {
          method: "POST", headers: headers(),
          body: JSON.stringify({ clientcode: credentials.clientcode, password: credentials.pin, totp: credentials.totp })
        });
        payload = await readProviderJson(providerResponse, { maxBytes: 256 * 1024 });
      } finally {
        credentials.pin = "";
        credentials.totp = "";
        if (req.body && typeof req.body === "object") {
          req.body.pin = "";
          req.body.totp = "";
        }
      }
      if (!providerResponse.ok || !isValidAngelOneLogin(payload)) {
        return res.status(401).json({ error: "Angel One login was not accepted. Check Client ID, PIN and current TOTP." });
      }
      const issuedAt = new Date();
      const expiry = nextAngelOneSessionExpiry(issuedAt.getTime());
      const encryptedBundle = encryptUpstoxToken(JSON.stringify({
        jwtToken: payload.data.jwtToken,
        refreshToken: payload.data.refreshToken,
        feedToken: payload.data.feedToken
      }), encryptionKey);
      const { error } = await serviceDb.from("broker_connections").upsert({
        user_id: user.id, broker_name: "angel_one", connection_status: "connected",
        access_token_ciphertext: encryptedBundle, refresh_token_ciphertext: null,
        token_expires_at: expiry.toISOString(), refresh_token_expires_at: null,
        provider_account_ref: credentials.clientcode, granted_scopes: [],
        last_authenticated_at: issuedAt.toISOString(), last_refreshed_at: null,
        last_error_code: null, encryption_key_version: "v1", updated_at: issuedAt.toISOString()
      }, { onConflict: "user_id,broker_name" });
      if (error) {
        logger.error("Angel One session save failed:", error.code || "database_error");
        return res.status(503).json({ error: "Angel One session could not be stored securely." });
      }
      return res.set("Cache-Control", "no-store").json({ connected: true, expiresAt: expiry.getTime() });
    } catch (error) {
      logger.error("Angel One session request failed:", error.status || "provider_error");
      return res.status(Number.isInteger(error.status) ? error.status : 502)
        .json({ error: "Angel One login could not be completed securely." });
    }
  });

  router.get("/connection", async (req, res) => {
    try {
      const { user } = await auth(req);
      const { data, error } = await serviceDb.from("broker_connections")
        .select("connection_status,token_expires_at,last_authenticated_at,provider_account_ref")
        .eq("user_id", user.id).eq("broker_name", "angel_one").maybeSingle();
      if (error) throw Object.assign(new Error("status unavailable"), { status: 503 });
      const expiresAt = data?.token_expires_at ? Date.parse(data.token_expires_at) : null;
      const connected = data?.connection_status === "connected" && Number.isFinite(expiresAt) && expiresAt > Date.now();
      res.set("Cache-Control", "private, no-store").json({
        connected, status: connected ? "connected" : (data?.connection_status || "disconnected"),
        expiresAt: connected ? expiresAt : null,
        account: connected ? data.provider_account_ref : null
      });
    } catch (error) {
      res.status(Number.isInteger(error.status) ? error.status : 500).json({ error: "Angel One connection status is unavailable." });
    }
  });

  router.delete("/connection", async (req, res) => {
    try {
      const { user } = await auth(req);
      const { data, error } = await serviceDb.from("broker_connections")
        .select("access_token_ciphertext,provider_account_ref")
        .eq("user_id", user.id).eq("broker_name", "angel_one").maybeSingle();
      if (error) throw Object.assign(new Error("session lookup failed"), { status: 503 });
      let session = null;
      if (data?.access_token_ciphertext) {
        try { session = JSON.parse(decryptUpstoxToken(data.access_token_ciphertext, encryptionKey)); } catch (_) { session = null; }
      }
      const { error: clearError } = await serviceDb.from("broker_connections").update({
        connection_status: "disconnected", access_token_ciphertext: null, refresh_token_ciphertext: null,
        token_expires_at: null, refresh_token_expires_at: null, updated_at: new Date().toISOString()
      }).eq("user_id", user.id).eq("broker_name", "angel_one");
      if (clearError) throw Object.assign(new Error("session clear failed"), { status: 503 });
      let providerRevoked = "not_attempted";
      if (session?.jwtToken && data?.provider_account_ref && apiKey) {
        try {
          const response = await fetchProvider(LOGOUT_URL, {
            method: "POST", headers: { ...headers(), Authorization: "Bearer " + session.jwtToken },
            body: JSON.stringify({ clientcode: data.provider_account_ref })
          });
          const result = await readProviderJson(response, { maxBytes: 128 * 1024 });
          providerRevoked = response.ok && result?.status === true ? "confirmed" : "unconfirmed";
        } catch (_) { providerRevoked = "unconfirmed"; }
      }
      res.set("Cache-Control", "no-store").json({ disconnected: true, providerRevocation: providerRevoked });
    } catch (error) {
      res.status(Number.isInteger(error.status) ? error.status : 503).json({ error: "Angel One disconnect could not be completed." });
    }
  });
  return router;
}

module.exports = { createAngelOneRouter, isValidAngelOneLogin, nextAngelOneSessionExpiry, validateAngelOneCredentials };
