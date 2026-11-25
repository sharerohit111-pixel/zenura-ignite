"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "connect.js"), "utf8");

test("status refresh rejects stale auth sequences before signed-out and no-gateway UI branches", () => {
  const refresh = source.slice(source.indexOf("async function refreshStatus"), source.indexOf('disconnectButton.addEventListener'));
  assert.match(refresh, /const session = await sessionSnapshot\(\)\.catch\(\(\) => null\);\s*if \(sequence !== authStateSequence\) return;/);
  assert.match(refresh, /if \(!session\?\.user\)\s*\{\s*setState\("SIGN IN REQUIRED"/);
  assert.match(refresh, /if \(!gateway\)\s*\{\s*if \(sequence !== authStateSequence\) return;\s*setState\("SUPABASE SIGNED IN"/);
});

test("connection status request uses the session snapshot captured for that auth sequence", () => {
  assert.match(source, /async function api\(path, options = \{\}, sessionOverride = null\)/);
  assert.match(source, /const data = await api\("\/upstox\/connection", \{\}, session\);/);
  assert.match(source, /if \(sequence !== authStateSequence\) return;\s*if \(data\.connected\)/);
});

test("OAuth start cannot navigate using a stale account response", () => {
  const handler = source.slice(source.indexOf('button.addEventListener("click"'), source.indexOf("window.ZENURA_MARKET_CONNECTOR"));
  assert.match(handler, /const sequence = authStateSequence;/);
  assert.match(handler, /if \(sequence !== authStateSequence\) return;\s*const url = result\.authorizationUrl;/);
  assert.match(handler, /if \(sequence === authStateSequence\) setState\("CONNECTION NOT COMPLETED"/);
});

test("disconnect response and errors cannot overwrite a newer account's status", () => {
  const handler = source.slice(source.indexOf('disconnectButton.addEventListener("click"'), source.indexOf('button.addEventListener("click"'));
  assert.match(handler, /if \(sequence !== authStateSequence\) return;/);
  assert.match(handler, /if \(sequence === authStateSequence\) setState\("DISCONNECT FAILED"/);
});
