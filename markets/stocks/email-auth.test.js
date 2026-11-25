"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "email-auth.js"), "utf8");

test("email sign-in and sign-up use Supabase Auth with bounded credential inputs", () => {
  assert.match(source, /supabase\.auth\.signInWithPassword\(/);
  assert.match(source, /supabase\.auth\.signUp\(/);
  assert.match(source, /type="email"/);
  assert.match(source, /maxlength="254"/);
  assert.match(source, /maxlength="128"/);
});

test("email auth ignores stale success and error responses after an auth-state transition", () => {
  assert.match(source, /let authSequence = 0/);
  assert.match(source, /const isCurrent = sequence => sequence === authSequence/);
  assert.match(source, /if \(!isCurrent\(sequence\)\) return;/);
  assert.match(source, /authSequence\+\+/);
});

test("email sign-out handles failures and does not overwrite a newer session UI", () => {
  assert.match(source, /const sequence = authSequence;[\s\S]*?supabase\.auth\.signOut\(\)/);
  assert.match(source, /if \(isCurrent\(sequence\)\) message\.textContent = error\?\.message \|\| "Signed out\."/);
  assert.match(source, /if \(isCurrent\(sequence\)\) message\.textContent = error\?\.message \|\| "Sign out failed\."/);
});

test("auth-state transitions are the authority for showing or hiding credential controls", () => {
  assert.match(source, /supabase\.auth\.onAuthStateChange\(\(_event, session\) => \{\s*authSequence\+\+/);
  assert.match(source, /email\.hidden = true/);
  assert.match(source, /email\.hidden = false/);
  assert.match(source, /signOutButton\.hidden = false/);
  assert.match(source, /signOutButton\.hidden = true/);
});

test("auth-state changes release stale busy controls", () => {
  assert.match(source, /authSequence\+\+;\s*signIn\.disabled = false;\s*create\.disabled = false;\s*signOutButton\.disabled = false;/);
});
