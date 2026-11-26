"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

// Configure a disposable Supabase client before loading the real Express app.
// Its auth transport is stubbed below; no external service or market-data
// provider is contacted by these route tests.
process.env.SUPABASE_URL = "https://s-trade-route-tests.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.UPSTOX_TOKEN_ENCRYPTION_KEY = "test-only-encryption-key";
process.env.MARKET_DATA_RIGHTS_APPROVED = "false";
process.env.MARKET_DATA_RIGHTS_REFERENCE = "";
process.env.MARKET_DATA_REGULATORY_APPROVED = "false";
process.env.MARKET_DATA_REGULATORY_REFERENCE = "";

const nativeFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url || String(input);
  if (url.startsWith(process.env.SUPABASE_URL + "/auth/v1/user")) {
    return new Response(JSON.stringify({
      id: "11111111-1111-4111-8111-111111111111",
      email: "route-test@example.invalid",
      email_confirmed_at: "2026-01-01T00:00:00.000Z"
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("Unexpected outbound request in /instruments compliance test: " + url);
};

const { app } = require("../supabase-server");
const server = app.listen(0, "127.0.0.1");
let endpoint;
test.before(async () => {
  await once(server, "listening");
  endpoint = "http://127.0.0.1:" + server.address().port + "/instruments";
});

async function requestInstruments(authenticated) {
  const headers = authenticated ? { authorization: "Bearer route-test-access-token" } : {};
  return nativeFetch(endpoint, { headers });
}

test("GET /instruments rejects anonymous requests before serving instrument data", async () => {
  process.env.MARKET_DATA_RIGHTS_APPROVED = "true";
  process.env.MARKET_DATA_RIGHTS_REFERENCE = "provider-agreement-ref";
  process.env.MARKET_DATA_REGULATORY_APPROVED = "true";
  process.env.MARKET_DATA_REGULATORY_REFERENCE = "counsel-clearance-ref";

  const response = await requestInstruments(false);
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error, "Sign in required");
});

test("GET /instruments fails closed when provider rights approval is absent", async () => {
  process.env.MARKET_DATA_RIGHTS_APPROVED = "false";
  process.env.MARKET_DATA_RIGHTS_REFERENCE = "provider-agreement-ref";
  process.env.MARKET_DATA_REGULATORY_APPROVED = "true";
  process.env.MARKET_DATA_REGULATORY_REFERENCE = "counsel-clearance-ref";

  const response = await requestInstruments(true);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, "market_data_rights_not_approved");
});

test("GET /instruments fails closed when separate regulatory clearance is absent", async () => {
  process.env.MARKET_DATA_RIGHTS_APPROVED = "true";
  process.env.MARKET_DATA_RIGHTS_REFERENCE = "provider-agreement-ref";
  process.env.MARKET_DATA_REGULATORY_APPROVED = "false";
  process.env.MARKET_DATA_REGULATORY_REFERENCE = "counsel-clearance-ref";

  const response = await requestInstruments(true);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, "market_data_rights_not_approved");
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  global.fetch = nativeFetch;
});
