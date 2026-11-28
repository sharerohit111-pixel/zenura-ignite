"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidAngelOneLogin, nextAngelOneSessionExpiry, validateAngelOneCredentials } = require("../lib/angel-one-smartapi");

test("Angel One login requires bounded client ID, PIN and current six digit TOTP", () => {
  assert.deepEqual(validateAngelOneCredentials({ clientcode: "AB1234", pin: "1234", totp: "654321" }),
    { clientcode: "AB1234", pin: "1234", totp: "654321" });
  assert.equal(validateAngelOneCredentials({ clientcode: "AB1234", pin: "123", totp: "654321" }), null);
  assert.equal(validateAngelOneCredentials({ clientcode: "AB1234", pin: "1234", totp: "65432" }), null);
  assert.equal(validateAngelOneCredentials({ clientcode: "AB1234", pin: "1234", totp: "654321", extra: "unexpected" }), null);
  assert.equal(validateAngelOneCredentials(null), null);
});

test("Angel One session response must contain JWT, refresh and feed tokens", () => {
  assert.equal(isValidAngelOneLogin({ status: true, data: { jwtToken: "j", refreshToken: "r", feedToken: "f" } }), true);
  assert.equal(isValidAngelOneLogin({ status: true, data: { jwtToken: "j", refreshToken: "r" } }), false);
  assert.equal(isValidAngelOneLogin({ status: false, data: null }), false);
});

test("Angel One session expiry is midnight on the next India-local day", () => {
  const now = Date.parse("2026-11-28T12:00:00.000Z");
  assert.equal(nextAngelOneSessionExpiry(now).toISOString(), "2026-11-28T18:30:00.000Z");
  assert.throws(() => nextAngelOneSessionExpiry(-1));
});

test("Angel One adapter never persists or logs PIN and TOTP", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../lib/angel-one-smartapi.js"), "utf8");
  assert.match(source, /credentials\.pin = ""/);
  assert.match(source, /credentials\.totp = ""/);
  assert.match(source, /req\.body\.pin = ""/);
  assert.match(source, /req\.body\.totp = ""/);
  assert.match(source, /catch \(error\) \{\s*credentials\.pin = "";\s*credentials\.totp = "";\s*throw error;/,
    "credentials must be cleared when the database login limiter throws");
  assert.ok(source.indexOf("req.body.pin =") < source.indexOf("if (!credentials)"),
    "request PIN must be cleared before invalid-credential early return");
  assert.doesNotMatch(source, /logger\.(?:info|warn|error)\([^\n]*(?:pin|totp|password)/i);
  assert.match(source, /access_token_ciphertext: encryptedBundle/);
  assert.match(source, /payload\.data\.jwtToken = ""/);
  assert.match(source, /payload\.data\.refreshToken = ""/);
  assert.match(source, /payload\.data\.feedToken = ""/);
  assert.match(source, /eq\("broker_name", "angel_one"\)/);
});

test("Angel One provider logout sends the required authenticated session headers", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../lib/angel-one-smartapi.js"), "utf8");
  assert.match(source, /Authorization: "Bearer " \+ session\.jwtToken/);
  assert.match(source, /"x-api-key": apiKey/);
  assert.match(source, /"x-client-code": data\.provider_account_ref/);
  assert.match(source, /"x-feed-token": session\.feedToken/);
});

test("Angel One login limiter is database-backed and fails closed", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../lib/angel-one-smartapi.js"), "utf8");
  assert.match(source, /reserve_angel_one_login_attempt/);
  assert.match(source, /rateError \|\| !rate/);
  assert.doesNotMatch(source, /new Map\(\)/);
});

test("Angel One server requires explicit real network header configuration", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const server = fs.readFileSync(path.join(__dirname, "../supabase-server.js"), "utf8");
  assert.match(server, /clientLocalIp:process\.env\.ANGEL_ONE_CLIENT_LOCAL_IP,/);
  assert.match(server, /clientPublicIp:process\.env\.ANGEL_ONE_CLIENT_PUBLIC_IP,/);
  assert.match(server, /macAddress:process\.env\.ANGEL_ONE_MAC_ADDRESS,/);
  assert.doesNotMatch(server, /ANGEL_ONE_CLIENT_LOCAL_IP\|\|/);
  assert.doesNotMatch(server, /ANGEL_ONE_CLIENT_PUBLIC_IP\|\|/);
  assert.doesNotMatch(server, /ANGEL_ONE_MAC_ADDRESS\|\|/);
});

test("Angel One adapter has no default placeholder network identity", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../lib/angel-one-smartapi.js"), "utf8");
  assert.doesNotMatch(source, /clientLocalIp\s*=\s*["']/);
  assert.doesNotMatch(source, /clientPublicIp\s*=\s*["']/);
  assert.doesNotMatch(source, /macAddress\s*=\s*["']/);
});
