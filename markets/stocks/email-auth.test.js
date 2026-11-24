"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "email-auth.js"), "utf8");

test("registration and password login use native Supabase Auth", () => {
  assert.match(source, /supabase\.auth\.signUp\(/);
  assert.match(source, /supabase\.auth\.signInWithPassword\(/);
  assert.match(source, /emailRedirectTo: location\.origin \+ location\.pathname/);
  assert.match(source, /minlength="8"/);
});

test("Google login delegates OAuth to Supabase and uses a same-origin callback", () => {
  assert.match(source, /supabase\.auth\.signInWithOAuth\(/);
  assert.match(source, /provider: "google"/);
  assert.match(source, /redirectTo: location\.origin \+ location\.pathname/);
});

test("password recovery uses Supabase and avoids account enumeration in the success message", () => {
  assert.match(source, /supabase\.auth\.resetPasswordForEmail\(/);
  assert.match(source, /If this email belongs to an account, a password reset link has been sent\./);
});

test("logout and auth-state UI are driven by Supabase session state", () => {
  assert.match(source, /supabase\.auth\.signOut\(\)/);
  assert.match(source, /supabase\.auth\.onAuthStateChange/);
  assert.match(source, /signOutButton\.hidden = false/);
  assert.match(source, /signOutButton\.hidden = true/);
});

test("browser auth contains no mock identity or production bypass", () => {
  assert.doesNotMatch(source, /mockUser|mockSession|bypassAuth|service_role|SUPABASE_SERVICE_ROLE_KEY/i);
});
