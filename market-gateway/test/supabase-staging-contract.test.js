"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { before, after } = require("node:test");
const {
  STAGING_DISABLED_FLAGS,
  assertStagingWorkersDisabled
} = require("../lib/staging-worker-policy");

test("staging worker policy accepts unset and explicitly false flags", () => {
  assert.equal(STAGING_DISABLED_FLAGS.length, 7);
  assert.deepEqual(assertStagingWorkersDisabled({}), Object.fromEntries(STAGING_DISABLED_FLAGS.map(name => [name, false])));
  assert.deepEqual(
    assertStagingWorkersDisabled(Object.fromEntries(STAGING_DISABLED_FLAGS.map(name => [name, "false"]))),
    Object.fromEntries(STAGING_DISABLED_FLAGS.map(name => [name, false]))
  );
});

test("staging worker policy fails closed for every enabled worker or order flag", () => {
  for (const flag of STAGING_DISABLED_FLAGS) {
    assert.throws(
      () => assertStagingWorkersDisabled({ [flag]: "true" }),
      new RegExp(flag)
    );
  }
  assert.throws(() => assertStagingWorkersDisabled({ PAPER_LIMIT_WORKER_ENABLED: "TRUE " }), /PAPER_LIMIT_WORKER_ENABLED/);
});

let httpServer;
let baseUrl;
before(async () => {
  // Dummy values only: this test never starts the gateway or contacts Supabase/Upstox.
  process.env.SUPABASE_URL = "https://staging-contract.invalid";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_disposable_contract_test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "disposable-service-role-contract-test";
  process.env.ALLOWED_ORIGINS = "https://staging-ui.example.test";
  const { app } = require("../supabase-server");
  httpServer = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  baseUrl = "http://127.0.0.1:" + httpServer.address().port;
});

after(async () => {
  if (httpServer) await new Promise((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
});

test("health endpoint is a secret-free liveness response, not a readiness claim", async () => {
  const response = await fetch(baseUrl + "/health");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "zenura-supabase-market-gateway");
  assert.equal(body.limitWorker.enabled, false);
  assert.equal(body.intradayLimitWorker.enabled, false);
  assert.equal(body.futuresLimitWorker.enabled, false);
  assert.equal(body.optionsLimitWorker.enabled, false);
  assert.equal(body.protectiveWorker.enabled, false);
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /disposable-service-role-contract-test|disposable_contract_test|UPSTOX_CLIENT_SECRET/i);
});

test("paper order and portfolio APIs reject requests without a Bearer token", async () => {
  for (const route of ["/paper/orders", "/paper/portfolio?product=DELIVERY"]) {
    const response = await fetch(baseUrl + route);
    assert.equal(response.status, 401, route);
    assert.match((await response.json()).error, /Sign in required/);
  }
});

test("CORS preflight allows only the configured staging UI origin", async () => {
  const allowed = await fetch(baseUrl + "/paper/orders", {
    method: "OPTIONS",
    headers: { Origin: "https://staging-ui.example.test", "Access-Control-Request-Method": "GET" }
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://staging-ui.example.test");

  const denied = await fetch(baseUrl + "/paper/orders", {
    method: "OPTIONS",
    headers: { Origin: "https://untrusted.example.test", "Access-Control-Request-Method": "GET" }
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});
