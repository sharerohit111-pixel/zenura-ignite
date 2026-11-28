"use strict";

const crypto = require("node:crypto");
const express = require("express");
const { encryptUpstoxToken } = require("./upstox-token-crypto");

function nextFyersTokenExpiry(now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("Invalid token issue time.");
  // FYERS v3 documentation: access tokens expire daily at 06:30 Asia/Kolkata.
  const indiaNow = new Date(now + 330 * 60 * 1000);
  const expiryUtc = Date.UTC(indiaNow.getUTCFullYear(), indiaNow.getUTCMonth(), indiaNow.getUTCDate(), 6, 30, 0, 0) - 330 * 60 * 1000;
  return new Date(expiryUtc > now ? expiryUtc : expiryUtc + 86400000);
}

function isValidFyersRedirectUri(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.pathname.endsWith("/fyers/oauth/callback")
      && !url.username && !url.password && !url.search && !url.hash;
  } catch (_) { return false; }
}

function isUsableFyersTokenResponse(payload) {
  return !!payload && payload.s === "ok" && Number(payload.code) === 200
    && typeof payload.access_token === "string" && payload.access_token.trim().length > 0
    && payload.access_token.length <= 16384 && !/[\x00-\x1f\x7f]/.test(payload.access_token);
}

function createFyersOAuthRouter({ auth, serviceDb, fetchProvider, readProviderJson, appRedirectUri,
  clientId, clientSecret, redirectUri, encryptionKey, logger = console }) {
  const router = express.Router();
  function finish(res, status) {
    res.set({ "Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer" });
    const target = new URL(appRedirectUri);
    target.searchParams.set("fyers", status);
    res.redirect(303, target.toString());
  }

  router.post("/oauth/start", async (req, res) => {
    try {
      const { user } = await auth(req);
      if (!user.emailConfirmedAt) return res.status(403).json({ error: "Verify your Supabase email before connecting FYERS.", code: "email_not_confirmed" });
      if (!clientId || !clientSecret || !isValidFyersRedirectUri(redirectUri) || !encryptionKey) {
        return res.status(503).json({ error: "FYERS OAuth server configuration is incomplete." });
      }
      const state = crypto.randomBytes(32).toString("hex");
      const stateHash = crypto.createHash("sha256").update(state).digest("hex");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { error } = await serviceDb.rpc("begin_broker_oauth_state", {
        p_state_hash: stateHash, p_user_id: user.id, p_broker_name: "fyers", p_expires_at: expiresAt
      });
      if (error) throw Object.assign(new Error("Secure FYERS authorization could not be started."), { status: 503 });
      const params = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: "code", state
      });
      res.set("Cache-Control", "no-store");
      res.json({ authorizationUrl: "https://api-t1.fyers.in/api/v3/generate-authcode?" + params.toString() });
    } catch (error) {
      res.status(Number.isInteger(error.status) ? error.status : 500)
        .json({ error: error.status ? error.message : "FYERS authorization could not be started." });
    }
  });

  router.get("/connection", async (req, res) => {
    try {
      const { user } = await auth(req);
      const { data, error } = await serviceDb.from("broker_connections")
        .select("connection_status,token_expires_at,last_authenticated_at")
        .eq("user_id", user.id).eq("broker_name", "fyers").maybeSingle();
      if (error) throw Object.assign(new Error("FYERS connection status is unavailable."), { status: 503 });
      const expiresAt = data?.token_expires_at ? Date.parse(data.token_expires_at) : null;
      const connected = data?.connection_status === "connected" && Number.isFinite(expiresAt) && expiresAt > Date.now();
      res.set("Cache-Control", "private, no-store").json({
        connected,
        status: connected ? "connected" : (data?.connection_status || "disconnected"),
        expiresAt: connected ? expiresAt : null,
        lastAuthenticatedAt: data?.last_authenticated_at || null
      });
    } catch (error) {
      res.status(Number.isInteger(error.status) ? error.status : 500)
        .json({ error: error.status ? error.message : "FYERS connection status could not be loaded." });
    }
  });

  router.delete("/connection", async (req, res) => {
    try {
      const { user } = await auth(req);
      const { error } = await serviceDb.from("broker_connections").update({
        connection_status: "disconnected",
        access_token_ciphertext: null,
        refresh_token_ciphertext: null,
        token_expires_at: null,
        refresh_token_expires_at: null,
        updated_at: new Date().toISOString()
      }).eq("user_id", user.id).eq("broker_name", "fyers");
      if (error) throw Object.assign(new Error("FYERS connection could not be disconnected."), { status: 503 });
      res.set("Cache-Control", "no-store").json({ disconnected: true });
    } catch (error) {
      res.status(Number.isInteger(error.status) ? error.status : 500)
        .json({ error: error.status ? error.message : "FYERS disconnect failed." });
    }
  });

  router.get("/oauth/callback", async (req, res) => {
    try {
      const code = req.query.auth_code;
      const state = req.query.state;
      if (typeof code !== "string" || !code.trim() || code.length > 8192
        || typeof state !== "string" || !/^[a-f0-9]{64}$/.test(state)
        || req.query.s === "error") return finish(res, "error");
      if (!clientId || !clientSecret || !isValidFyersRedirectUri(redirectUri) || !encryptionKey) return finish(res, "error");
      const stateHash = crypto.createHash("sha256").update(state).digest("hex");
      const { data: stateData, error: stateError } = await serviceDb.rpc("consume_broker_oauth_state", {
        p_state_hash: stateHash, p_broker_name: "fyers"
      });
      const consumed = Array.isArray(stateData) ? stateData[0] : stateData;
      if (stateError || !consumed || !consumed.user_id) return finish(res, "error");

      const appIdHash = crypto.createHash("sha256").update(clientId + ":" + clientSecret).digest("hex");
      const tokenResponse = await fetchProvider("https://api-t1.fyers.in/api/v3/validate-authcode", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code", appIdHash, code })
      });
      const tokenPayload = await readProviderJson(tokenResponse);
      if (!tokenResponse.ok || !isUsableFyersTokenResponse(tokenPayload)) return finish(res, "error");

      const issuedAt = new Date();
      const expiresAt = nextFyersTokenExpiry(issuedAt.getTime());
      const encryptedAccessToken = encryptUpstoxToken(tokenPayload.access_token, encryptionKey);
      // Drop the plaintext provider token reference before database I/O.
      tokenPayload.access_token = "";
      const row = {
        user_id: consumed.user_id,
        broker_name: "fyers",
        connection_status: "connected",
        access_token_ciphertext: encryptedAccessToken,
        refresh_token_ciphertext: null,
        token_expires_at: expiresAt.toISOString(),
        refresh_token_expires_at: null,
        provider_account_ref: null,
        granted_scopes: [],
        last_authenticated_at: issuedAt.toISOString(),
        last_refreshed_at: null,
        last_error_code: null,
        encryption_key_version: "v1",
        updated_at: issuedAt.toISOString()
      };
      const { error: saveError } = await serviceDb.from("broker_connections")
        .upsert(row, { onConflict: "user_id,broker_name" });
      if (saveError) {
        logger.error("FYERS connection save failed:", saveError.code || "database_error");
        return finish(res, "error");
      }
      return finish(res, "connected");
    } catch (error) {
      logger.error("FYERS OAuth callback failed:", error.message);
      return finish(res, "error");
    }
  });
  return router;
}

module.exports = { createFyersOAuthRouter, isUsableFyersTokenResponse, isValidFyersRedirectUri, nextFyersTokenExpiry };
