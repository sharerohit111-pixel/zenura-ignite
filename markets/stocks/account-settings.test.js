"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "account-settings.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "account-settings.css"), "utf8");

test("mobile OTP uses Supabase phone OTP and verifies only SMS codes", () => {
  assert.match(source, /signInWithOtp\(\{ phone, options: \{ shouldCreateUser: true \} \}\)/);
  assert.match(source, /verifyOtp\(\{ phone, token, type: "sms" \}\)/);
  assert.match(source, /\^\\\+\[1-9\]\\d\{7,14\}\$/);
  assert.match(source, /\^\\d\{4,8\}\$/);
});

test("profile updates only the signed-in user's Auth metadata", () => {
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.match(source, /supabase\.auth\.updateUser\(\{ data: \{ display_name: displayName \} \}\)/);
  assert.match(source, /data\.user\?\.id !== currentUserId/);
});

test("session refresh, auth-state clearing and logout are wired", () => {
  assert.match(source, /supabase\.auth\.refreshSession\(\)/);
  assert.match(source, /supabase\.auth\.onAuthStateChange/);
  assert.match(source, /supabase\.auth\.signOut\(\)/);
  assert.match(source, /function clearWallet\(\)/);
  assert.match(source, /currentUserId = user\?\.id \|\| null/);
});

test("wallet requests use the active user's bearer token and no-store caching", () => {
  assert.match(source, /Authorization: "Bearer " \+ data\.session\.access_token/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /payload\.availableCashPaise/);
  assert.match(source, /ledger reconciliation is not yet enabled/);
  assert.doesNotMatch(source, /service_role|SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY/i);
});

test("account settings layout is responsive and does not expose controls while signed out", () => {
  assert.match(source, /privatePanel\.hidden = true/);
  assert.match(source, /phonePanel\.hidden = false/);
  assert.match(css, /@media\(max-width:520px\)/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});


test("development mock login is localhost-only and never creates a backend auth session", () => {
  assert.ok(source.includes('["localhost", "127.0.0.1", "[::1]"]'));
  assert.ok(source.includes("if (!isLocalDevelopment) mockButton.remove()"));
  assert.match(source, /DEVELOPMENT MOCK SESSION — local UI preview only/);
  assert.match(source, /No API access, orders, database writes or real authentication/);
  assert.match(source, /devMockActive = true/);
  assert.match(source, /if \(devMockActive\) return/);
  assert.match(source, /devMockActive = false/);
  assert.ok(source.includes("Profile editing is disabled in the local mock preview."));
  assert.ok(source.includes("There is no authenticated session to refresh in mock preview."));
  assert.ok(source.includes("Wallet refresh is disabled in the local mock preview."));
  assert.doesNotMatch(source, /localStorage|sessionStorage|service_role|SUPABASE_SERVICE_ROLE_KEY/i);
});
