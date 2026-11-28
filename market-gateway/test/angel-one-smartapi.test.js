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
  assert.ok(source.indexOf("req.body.pin =") < source.indexOf("const { user } = await auth(req)"),
    "request PIN must be cleared before authentication can fail");
  assert.ok(source.indexOf("req.body.totp =") < source.indexOf("const { user } = await auth(req)"),
    "request TOTP must be cleared before authentication can fail");
  assert.match(source, /finally \{[\s\S]*?Cover auth\/configuration\/rate-limit\/provider\/database failures and every early return\.[\s\S]*?credentials\.pin = ""; credentials\.totp = "";[\s\S]*?req\.body\.pin = ""; req\.body\.totp = "";/,
    "credential references must be cleared on all handler exits");
  assert.doesNotMatch(source, /logger\.(?:info|warn|error)\([^\n]*(?:pin|totp|password)/i);
  assert.match(source, /access_token_ciphertext: encryptedBundle/);
  assert.match(source, /payload\.data\.jwtToken = ""/);
  assert.match(source, /payload\.data\.refreshToken = ""/);
  assert.match(source, /payload\.data\.feedToken = ""/);
  assert.match(source, /if \(!providerResponse\.ok \|\| !isValidAngelOneLogin\(payload\)\) \{[\s\S]*?return res\.status\(401\)[\s\S]*?encryptedBundle = encryptUpstoxToken/,
    "provider response validation must run inside the token cleanup try/finally");
  assert.match(source, /finally \{\s*\/\/ Clear token-like fields for success, invalid responses and encryption failures\.[\s\S]*?if \(payload\?\.data && typeof payload\.data === "object"\) \{[\s\S]*?payload\.data\.jwtToken = "";\s*payload\.data\.refreshToken = "";\s*payload\.data\.feedToken = "";/);
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
  assert.match(source, /let providerRevoked = "not_attempted";[\s\S]*?try \{[\s\S]*?const \{ error: clearError \} = await serviceDb\.from\("broker_connections"\)\.update\([\s\S]*?if \(session\?\.jwtToken && data\?\.provider_account_ref && apiKey\) \{[\s\S]*?\}\s*res\.set\("Cache-Control", "no-store"\)\.json\(\{ disconnected: true, providerRevocation: providerRevoked \}\);\s*\} finally \{\s*\/\/ Clear decrypted token references even when revocation is skipped or DB clearing fails\.[\s\S]*?if \(session && typeof session === "object"\) \{\s*session\.jwtToken = "";\s*session\.refreshToken = "";\s*session\.feedToken = "";\s*\}/);
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
