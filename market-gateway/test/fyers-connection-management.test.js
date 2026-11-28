"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const router = fs.readFileSync(path.join(__dirname, "../lib/fyers-oauth.js"), "utf8");
const modal = fs.readFileSync(path.join(__dirname, "../../markets/stocks/broker-connect-modal.js"), "utf8");
const connector = fs.readFileSync(path.join(__dirname, "../../markets/stocks/connect.js"), "utf8");

test("FYERS connection status is scoped to the authenticated user's FYERS row", () => {
  assert.match(router, /router\.get\("\/connection"/);
  assert.match(router, /\.eq\("user_id", user\.id\)\.eq\("broker_name", "fyers"\)/);
  assert.match(router, /connection_status === "connected"/);
  assert.match(router, /expiresAt > Date\.now\(\)/);
  assert.match(router, /Cache-Control.*private, no-store/);
});

test("FYERS disconnect clears only that user's FYERS token envelope", () => {
  assert.match(router, /router\.delete\("\/connection"/);
  assert.match(router, /connection_status: "disconnected"/);
  assert.match(router, /access_token_ciphertext: null/);
  assert.match(router, /refresh_token_ciphertext: null/);
  assert.match(router, /\.eq\("user_id", user\.id\)\.eq\("broker_name", "fyers"\)/);
});

test("broker modal exposes FYERS status and disconnect without replacing other broker controls", () => {
  assert.match(modal, /data-fyers-status/);
  assert.match(modal, /data-fyers-disconnect/);
  assert.match(modal, /ZENURA_GET_BROKER_STATUS/);
  assert.match(modal, /ZENURA_DISCONNECT_BROKER/);
  assert.match(connector, /api\("\/fyers\/connection", \{ method: "DELETE" \}\)/);
  assert.match(connector, /api\("\/fyers\/connection"\)/);
});
