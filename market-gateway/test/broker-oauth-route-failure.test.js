"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createFyersOAuthRouter } = require("../lib/fyers-oauth");
const { createAngelOneRouter } = require("../lib/angel-one-smartapi");
const { encryptUpstoxToken } = require("../lib/upstox-token-crypto");

const KEY = crypto.randomBytes(32).toString("base64");

function response() {
  return {
    statusCode: 200, headers: {}, body: null, redirectStatus: null, redirectUrl: null,
    status(code) { this.statusCode = code; return this; },
    set(name, value) {
      if (typeof name === "object") Object.assign(this.headers, name);
      else this.headers[name] = value;
      return this;
    },
    json(value) { this.body = value; return this; },
    redirect(code, url) { this.redirectStatus = code; this.redirectUrl = url; return this; }
  };
}

function routeHandler(router, method, routePath) {
  const layer = router.stack.find(item => item.route
    && item.route.path === routePath && item.route.methods[method]);
  assert.ok(layer, method.toUpperCase() + " " + routePath + " route exists");
  return layer.route.stack[0].handle;
}

function fyersHarness({ consume = { data: [{ user_id: "user-1" }], error: null },
  providerError = null, tokenPayload = { s: "ok", code: 200, access_token: "fyers-secret-token" },
  saveError = null } = {}) {
  const calls = { rpc: [], fetch: [], upsert: [] };
  const serviceDb = {
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      return consume;
    },
    from(table) {
      assert.equal(table, "broker_connections");
      return { upsert: async (row, options) => {
        calls.upsert.push({ row, options });
        return { error: saveError };
      }};
    }
  };
  const router = createFyersOAuthRouter({
    auth: async () => ({ user: { id: "user-1", emailConfirmedAt: "2026-01-01" } }),
    serviceDb,
    fetchProvider: async (url, options) => {
      calls.fetch.push({ url, options });
      if (providerError) throw providerError;
      return { ok: true };
    },
    readProviderJson: async () => tokenPayload,
    appRedirectUri: "https://app.example/markets/stocks/",
    clientId: "client-id", clientSecret: "client-secret",
    redirectUri: "https://gateway.example/fyers/oauth/callback",
    encryptionKey: KEY,
    logger: { error() {} }
  });
  return { router, calls, tokenPayload };
}

test("FYERS callback rejects malformed and replayed state before provider exchange", async () => {
  const h = fyersHarness({ consume: { data: [], error: null } });
  const handler = routeHandler(h.router, "get", "/oauth/callback");
  const malformed = response();
  await handler({ query: { auth_code: "code", state: "not-a-state" } }, malformed);
  assert.equal(malformed.redirectStatus, 303);
  assert.equal(new URL(malformed.redirectUrl).searchParams.get("fyers"), "error");
  assert.equal(h.calls.rpc.length, 0);
  const replay = response();
  await handler({ query: { auth_code: "code", state: "a".repeat(64) } }, replay);
  assert.equal(new URL(replay.redirectUrl).searchParams.get("fyers"), "error");
  assert.equal(h.calls.rpc.length, 1);
  assert.equal(h.calls.fetch.length, 0);
});

test("FYERS callback fails closed when state storage fails or provider exchange throws", async () => {
  const stateFailure = fyersHarness({ consume: { data: null, error: { code: "DB_DOWN" } } });
  const handler = routeHandler(stateFailure.router, "get", "/oauth/callback");
  const stateRes = response();
  await handler({ query: { auth_code: "code", state: "b".repeat(64) } }, stateRes);
  assert.equal(new URL(stateRes.redirectUrl).searchParams.get("fyers"), "error");
  assert.equal(stateFailure.calls.fetch.length, 0);

  const providerFailure = fyersHarness({ providerError: new Error("network failure") });
  const providerHandler = routeHandler(providerFailure.router, "get", "/oauth/callback");
  const providerRes = response();
  await providerHandler({ query: { auth_code: "code", state: "c".repeat(64) } }, providerRes);
  assert.equal(new URL(providerRes.redirectUrl).searchParams.get("fyers"), "error");
  assert.equal(providerFailure.calls.fetch.length, 1);
  assert.equal(providerFailure.calls.upsert.length, 0);
});

test("FYERS callback scrubs invalid token-like payloads and reports persistence failures", async () => {
  const invalidPayload = { s: "error", code: 401, access_token: "unexpected-secret" };
  const invalid = fyersHarness({ tokenPayload: invalidPayload });
  const handler = routeHandler(invalid.router, "get", "/oauth/callback");
  const invalidRes = response();
  await handler({ query: { auth_code: "code", state: "d".repeat(64) } }, invalidRes);
  assert.equal(invalidPayload.access_token, "");
  assert.equal(new URL(invalidRes.redirectUrl).searchParams.get("fyers"), "error");
  assert.equal(invalid.calls.upsert.length, 0);

  const persistence = fyersHarness({ saveError: { code: "WRITE_FAILED" } });
  const persistenceHandler = routeHandler(persistence.router, "get", "/oauth/callback");
  const persistenceRes = response();
  await persistenceHandler({ query: { auth_code: "code", state: "e".repeat(64) } }, persistenceRes);
  assert.equal(new URL(persistenceRes.redirectUrl).searchParams.get("fyers"), "error");
  assert.equal(persistence.calls.upsert.length, 1);
  assert.notEqual(persistence.calls.upsert[0].row.access_token_ciphertext, "fyers-secret-token");
});

test("FYERS callback stores only encrypted token material on successful exchange", async () => {
  const h = fyersHarness();
  const handler = routeHandler(h.router, "get", "/oauth/callback");
  const res = response();
  await handler({ query: { auth_code: "valid-code", state: "f".repeat(64) } }, res);
  assert.equal(new URL(res.redirectUrl).searchParams.get("fyers"), "connected");
  assert.equal(h.calls.rpc[0].name, "consume_broker_oauth_state");
  assert.equal(h.calls.rpc[0].args.p_broker_name, "fyers");
  assert.equal(h.calls.upsert.length, 1);
  assert.equal(h.calls.upsert[0].row.user_id, "user-1");
  assert.equal(h.calls.upsert[0].row.broker_name, "fyers");
  assert.notEqual(h.calls.upsert[0].row.access_token_ciphertext, "fyers-secret-token");
});

function angelDeleteHarness({ clearError = null, logoutError = null } = {}) {
  const calls = [];
  const envelope = encryptUpstoxToken(JSON.stringify({
    jwtToken: "angel-jwt", refreshToken: "angel-refresh", feedToken: "angel-feed"
  }), KEY);
  const row = { access_token_ciphertext: envelope, provider_account_ref: "AB1234" };
  const serviceDb = {
    from(table) {
      assert.equal(table, "broker_connections");
      const builder = {
        select() { calls.push("select"); return this; },
        update(value) { calls.push({ update: value }); return this; },
        eq(field, value) { calls.push({ eq: [field, value] }); return this; },
        async maybeSingle() { return { data: row, error: null }; },
        then(resolve, reject) { return Promise.resolve({ error: clearError }).then(resolve, reject); }
      };
      return builder;
    }
  };
  const router = createAngelOneRouter({
    auth: async () => ({ user: { id: "user-1", emailConfirmedAt: "2026-01-01" } }),
    serviceDb,
    fetchProvider: async (url, options) => {
      calls.push({ fetch: url, options });
      if (logoutError) throw logoutError;
      return { ok: true };
    },
    readProviderJson: async () => ({ status: true }),
    encryptionKey: KEY, apiKey: "api-key", clientLocalIp: "192.0.2.1",
    clientPublicIp: "198.51.100.1", macAddress: "AA:BB:CC:DD:EE:FF",
    sourceId: "WEB", logger: { error() {} }
  });
  return { router, calls };
}

test("Angel One disconnect clears local encrypted credentials before provider logout", async () => {
  const h = angelDeleteHarness();
  const handler = routeHandler(h.router, "delete", "/connection");
  const res = response();
  await handler({}, res);
  assert.equal(res.body.disconnected, true);
  assert.equal(res.body.providerRevocation, "confirmed");
  const updateIndex = h.calls.findIndex(x => x && x.update);
  const fetchIndex = h.calls.findIndex(x => x && x.fetch);
  assert.ok(updateIndex >= 0 && fetchIndex > updateIndex);
  const update = h.calls[updateIndex].update;
  assert.equal(update.connection_status, "disconnected");
  assert.equal(update.access_token_ciphertext, null);
  assert.ok(h.calls.some(x => x && x.eq?.[0] === "user_id" && x.eq[1] === "user-1"));
  assert.ok(h.calls.some(x => x && x.eq?.[0] === "broker_name" && x.eq[1] === "angel_one"));
  const logout = h.calls[fetchIndex];
  assert.equal(logout.options.headers.Authorization, "Bearer angel-jwt");
  assert.equal(logout.options.headers["x-feed-token"], "angel-feed");
});

test("Angel One disconnect does not call provider logout if local credential clearing fails", async () => {
  const h = angelDeleteHarness({ clearError: { code: "DB_WRITE_FAILED" } });
  const handler = routeHandler(h.router, "delete", "/connection");
  const res = response();
  await handler({}, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.disconnected, undefined);
  assert.equal(h.calls.some(x => x && x.fetch), false);
});

test("Angel One disconnect retains local disconnection when provider logout is unavailable", async () => {
  const h = angelDeleteHarness({ logoutError: new Error("provider offline") });
  const handler = routeHandler(h.router, "delete", "/connection");
  const res = response();
  await handler({}, res);
  assert.equal(res.body.disconnected, true);
  assert.equal(res.body.providerRevocation, "unconfirmed");
  assert.ok(h.calls.some(x => x && x.update));
});
