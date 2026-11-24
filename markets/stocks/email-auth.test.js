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

test("password recovery completes only after a PASSWORD_RECOVERY event and updates the Supabase password", () => {
  assert.match(source, /event === "PASSWORD_RECOVERY" && session\?\.user/);
  assert.match(source, /supabase\.auth\.updateUser\(\{ password: nextPassword \}\)/);
  assert.match(source, /Choose a new password between 8 and 128 characters\./);
  assert.match(source, /saveNewPasswordButton\.hidden = false/);
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

// Exercise the real auth module's event handlers with a minimal DOM and a mocked
// Supabase client. This is a Node DOM harness, not a real browser E2E test.
function createAuthHarness() {
  const elements = new Map();
  class Element {
    constructor(id = "") {
      this.id = id; this.listeners = {}; this.hidden = false; this.disabled = false;
      this.value = ""; this.textContent = ""; this.autocomplete = ""; this.minLength = 0;
    }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
    async dispatch(name, event = {}) {
      for (const callback of this.listeners[name] || []) await callback({ preventDefault() {}, ...event });
    }
    append(...children) { this.children = [...(this.children || []), ...children]; }
    focus() {}
    checkValidity() { return this.value.includes("@") && this.value.includes("."); }
    reportValidity() { return true; }
    set innerHTML(markup) {
      for (const match of markup.matchAll(/id="([^"]+)"/g)) {
        const child = new Element(match[1]); elements.set(match[1], child);
      }
    }
    querySelector(selector) { return elements.get(selector.replace(/^#/, "")); }
  }
  const card = new Element("connection");
  elements.set("upstox-connect", new Element("upstox-connect"));
  const calls = [];
  let authListener;
  const auth = {
    async signUp(args) { calls.push(["signUp", args]); return { data: { session: null }, error: null }; },
    async signInWithPassword(args) { calls.push(["signInWithPassword", args]); return { error: null }; },
    async signInWithOAuth(args) { calls.push(["signInWithOAuth", args]); return { error: null }; },
    async resetPasswordForEmail(...args) { calls.push(["resetPasswordForEmail", ...args]); return { error: null }; },
    async updateUser(args) { calls.push(["updateUser", args]); return { error: null }; },
    async signOut() { calls.push(["signOut"]); return { error: null }; },
    onAuthStateChange(callback) { authListener = callback; }
  };
  const document = {
    head: new Element("head"),
    getElementById(id) { return id === "connection" ? card : elements.get(id) || null; },
    createElement() { return new Element(); }
  };
  const vm = require("node:vm");
  vm.runInNewContext(source.replace('import { supabase } from "./supabase-client.js";',
    "const { supabase } = globalThis.__test;"), {
    document, location: { origin: "https://demo.example", pathname: "/markets/stocks/" },
    globalThis: { __test: { supabase: { auth } } }
  });
  return { elements, calls, authListener, form: card.children[0] };
}

test("auth module interactions call Supabase for registration, login, OAuth, recovery and logout", async () => {
  const { elements, calls, form } = createAuthHarness();
  const email = elements.get("market-email"), password = elements.get("market-password");
  email.value = "trader@example.com"; password.value = "StrongPass123";
  await elements.get("email-create").dispatch("click");
  await form.dispatch("submit");
  assert.equal(calls[0][0], "signUp");
  assert.equal(calls[0][1].email, "trader@example.com");
  assert.equal(calls[0][1].options.emailRedirectTo, "https://demo.example/markets/stocks/");

  await elements.get("email-create").dispatch("click");
  await form.dispatch("submit");
  assert.equal(calls[1][0], "signInWithPassword");

  await elements.get("email-google").dispatch("click");
  assert.equal(calls[2][0], "signInWithOAuth");
  assert.equal(calls[2][1].provider, "google");

  await elements.get("email-reset").dispatch("click");
  assert.equal(calls[3][0], "resetPasswordForEmail");
  assert.equal(elements.get("email-auth-message").textContent,
    "If this email belongs to an account, a password reset link has been sent.");

  await elements.get("email-sign-out").dispatch("click");
  assert.equal(calls[4][0], "signOut");
});

test("password recovery event exposes completion and persists the new password through Supabase", async () => {
  const { elements, calls, authListener } = createAuthHarness();
  authListener("PASSWORD_RECOVERY", { user: { id: "user-1" } });
  assert.equal(elements.get("email-save-new-password").hidden, false);
  assert.equal(elements.get("market-email").hidden, true);
  const password = elements.get("market-password");
  password.value = "NewSecurePass123";
  await elements.get("email-save-new-password").dispatch("click");
  assert.deepEqual(calls[0], ["updateUser", { password: "NewSecurePass123" }]);
  assert.equal(elements.get("email-save-new-password").hidden, true);
});
