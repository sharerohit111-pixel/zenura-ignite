"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "connect.js"), "utf8")
  .replace(/^import \{ supabase \} from "\.\/supabase-client\.js";\s*/m, "");

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function makeElement() {
  return {
    textContent: "", hidden: false, disabled: false,
    classList: { toggle() {} },
    addEventListener() {}
  };
}
function createHarness() {
  let activeSession = null;
  let authListener;
  const pendingFetches = [];
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const supabase = {
    auth: {
      async getSession() { return { data: { session: activeSession }, error: null }; },
      onAuthStateChange(callback) { authListener = callback; }
    }
  };
  const window = {
    dispatchEvent(event) { window.lastAuthEvent = event; },
    lastAuthEvent: null
  };
  const context = {
    window, supabase, document: {
      getElementById,
      querySelector(selector) {
        return selector.includes("market-gateway-url") ? { content: "https://gateway.test" } : null;
      }
    },
    fetch() {
      const request = deferred();
      pendingFetches.push(request);
      return request.promise;
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    URLSearchParams, URL, AbortSignal, location: { search: "", pathname: "/markets/stocks/" },
    history: { replaceState() {} }, queueMicrotask, console
  };
  vm.runInNewContext(source, context, { filename: "connect.js" });
  return {
    elements, pendingFetches, window,
    transition(userId, authEvent = "SIGNED_IN") {
      const previous = activeSession?.user?.id || null;
      activeSession = userId ? { access_token: "token-" + userId, user: { id: userId } } : null;
      authListener(authEvent, activeSession);
      return { previous, current: userId };
    }
  };
}

test("late User A API response cannot overwrite User B connection state after account switch", async () => {
  const h = createHarness();
  h.transition("user-A");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.pendingFetches.length, 1, "User A connection request should be in flight");

  h.transition("user-B", "SIGNED_IN");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.pendingFetches.length, 2, "User B must start an independent request");

  h.pendingFetches[0].resolve({ ok: true, async json() { return { connected: true, feedReady: true }; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(h.elements.get("connection-title").textContent, "UPSTOX AUTHORIZED",
    "late User A response must not publish its authenticated state");

  h.pendingFetches[1].resolve({ ok: true, async json() { return { connected: false }; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.elements.get("connection-title").textContent, "UPSTOX NOT CONNECTED",
    "the current User B response must own the visible connection state");
  assert.equal(h.window.lastAuthEvent.detail.previousUserId, "user-A");
  assert.equal(h.window.lastAuthEvent.detail.userId, "user-B");
  assert.equal(h.window.lastAuthEvent.detail.identityChanged, true);
});

test("late authenticated response after logout cannot restore signed-in UI", async () => {
  const h = createHarness();
  h.transition("user-A");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.pendingFetches.length, 1);

  h.transition(null, "SIGNED_OUT");
  h.pendingFetches[0].resolve({ ok: true, async json() { return { connected: true, feedReady: true }; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.elements.get("connection-title").textContent, "SIGN IN REQUIRED");
  assert.equal(h.window.lastAuthEvent.detail.userId, null);
});


test("LIMIT retry browser storage is isolated by authenticated user namespace", () => {
  const workspacePath = path.join(__dirname, "order-workspace.js");
  const workspace = fs.readFileSync(workspacePath, "utf8");
  const match = workspace.match(/function limitStorageKey\(uid\) \{ return ([^;]+); \}/);
  assert.ok(match, "LIMIT retry storage key helper must exist");
  const keyFor = vm.runInNewContext("(uid) => " + match[1]);
  const storage = new Map();
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  };
  const keyA = keyFor("user-A"), keyB = keyFor("user-B");
  assert.notEqual(keyA, keyB, "different authenticated users must never share a retry key");
  localStorage.setItem(keyA, JSON.stringify({ key: "retry-A", fingerprint: "order-A" }));
  localStorage.setItem(keyB, JSON.stringify({ key: "retry-B", fingerprint: "order-B" }));
  assert.equal(JSON.parse(localStorage.getItem(keyA)).key, "retry-A");
  assert.equal(JSON.parse(localStorage.getItem(keyB)).key, "retry-B");
  localStorage.removeItem(keyA);
  assert.equal(localStorage.getItem(keyA), null);
  assert.equal(JSON.parse(localStorage.getItem(keyB)).key, "retry-B",
    "clearing User A retry state must not clear User B state");
});

test("orders and balance responses are guarded before and after fetch by request sequence and user ID", () => {
  const workspace = fs.readFileSync(path.join(__dirname, "order-workspace.js"), "utf8");
  const balances = workspace.slice(workspace.indexOf("async function loadBalances()"), workspace.indexOf("async function loadOrders("));
  const orders = workspace.slice(workspace.indexOf("async function loadOrders("), workspace.indexOf("async function cancelOrder("));
  assert.match(balances, /const connector = window\.ZENURA_MARKET_CONNECTOR, uid = connector\?\.getUserId\?\.\(\), seq = \+\+balanceRequest/);
  assert.match(balances, /if \(seq !== balanceRequest \|\| connector\.getUserId\(\) !== uid\) return;/);
  assert.match(orders, /const connector = window\.ZENURA_MARKET_CONNECTOR, uid = connector\?\.getUserId\?\.\(\), seq = \+\+requestSeq/);
  assert.match(orders, /if \(seq !== requestSeq \|\| connector\.getUserId\(\) !== uid\) return;/);
  assert.match(orders, /currentOrders = append \? currentOrders\.concat\(incoming\) : incoming/);
});
