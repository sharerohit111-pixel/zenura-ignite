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


test("email and password changes are delegated to the active Supabase Auth user", () => {
  assert.ok(source.includes("supabase.auth.updateUser({ email })"));
  assert.ok(source.includes("supabase.auth.updateUser({ password })"));
  assert.ok(source.includes("Email change requested. Complete the confirmation steps sent by Supabase"));
  assert.ok(source.includes("Password updated successfully."));
  assert.ok(source.includes("Email changes are disabled in the local mock preview."));
  assert.ok(source.includes("Password changes are disabled in the local mock preview."));
  assert.ok(source.includes("password.length < 8 || password.length > 128"));
});

test("local UI cannot create a mock identity and private profile writes are guarded against stale sessions", () => {
  assert.doesNotMatch(source, /development-mock-user|DEVELOPMENT MOCK LOGIN|devMockActive|mockButton/);
  assert.match(source, /currentUserId !== userId \|\| authSequence !== sequence/);
  assert.match(source, /let authEventSeen = false/);
  assert.match(source, /if \(authEventSeen\) return/);
});
