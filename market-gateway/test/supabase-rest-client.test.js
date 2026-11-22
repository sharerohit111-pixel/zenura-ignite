"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSupabaseRestClient } = require("../lib/supabase-rest-client");

const BASE_URL = "https://atvbjibhunvzpmfagagm.supabase.co";
const SERVICE_KEY = "server-only-test-service-role-key-123456";
const USER_UUID = "a1b2c3d4-e5f6-4789-abcd-0123456789ab";

function fakeResponse({ status = 200, body = [] } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return typeof body === "string" ? body : JSON.stringify(body); }
  };
}

test("resolves Firebase UID using the private identity map and server-only credentials", async () => {
  let request;
  const client = createSupabaseRestClient({
    url: BASE_URL,
    serviceRoleKey: SERVICE_KEY,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return fakeResponse({ body: [{ supabase_user_id: USER_UUID.toUpperCase() }] });
    }
  });

  const result = await client.resolveFirebaseUid("firebase-uid/with+reserved?chars");

  assert.equal(result, USER_UUID);
  const url = new URL(request.url);
  assert.equal(url.pathname, "/rest/v1/paper_user_identity_map");
  assert.equal(url.searchParams.get("select"), "supabase_user_id");
  assert.equal(url.searchParams.get("firebase_uid"), "eq.firebase-uid/with+reserved?chars");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.headers.apikey, SERVICE_KEY);
  assert.equal(request.options.headers.Authorization, "Bearer " + SERVICE_KEY);
});

test("fails closed for an unmigrated Firebase UID", async () => {
  const client = createSupabaseRestClient({
    url: BASE_URL,
    serviceRoleKey: SERVICE_KEY,
    fetchImpl: async () => fakeResponse({ body: [] })
  });
  await assert.rejects(
    client.resolveFirebaseUid("legacy-user"),
    error => error.status === 409 && error.code === "SUPABASE_IDENTITY_NOT_MIGRATED"
  );
});

test("rejects duplicate or malformed identity mapping rows", async () => {
  const client = createSupabaseRestClient({
    url: BASE_URL,
    serviceRoleKey: SERVICE_KEY,
    fetchImpl: async () => fakeResponse({ body: [
      { supabase_user_id: USER_UUID },
      { supabase_user_id: USER_UUID }
    ] })
  });
  await assert.rejects(
    client.resolveFirebaseUid("legacy-user"),
    error => error.status === 503 && error.code === "SUPABASE_IDENTITY_MAPPING_INVALID"
  );
});

test("posts RPC arguments to the Supabase REST endpoint", async () => {
  let request;
  const client = createSupabaseRestClient({
    url: BASE_URL,
    serviceRoleKey: SERVICE_KEY,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return fakeResponse({ body: { status: "FILLED", simulation_only: true } });
    }
  });

  const result = await client.rpc("execute_paper_market_order", {
    p_user_id: USER_UUID,
    p_side: "BUY",
    p_quantity: 2
  });

  assert.deepEqual(result, { status: "FILLED", simulation_only: true });
  assert.equal(new URL(request.url).pathname, "/rest/v1/rpc/execute_paper_market_order");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer " + SERVICE_KEY);
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.options.body), {
    p_user_id: USER_UUID,
    p_side: "BUY",
    p_quantity: 2
  });
});

test("does not leak Supabase database error bodies", async () => {
  const client = createSupabaseRestClient({
    url: BASE_URL,
    serviceRoleKey: SERVICE_KEY,
    fetchImpl: async () => fakeResponse({ status: 403, body: { message: "private SQL detail" } })
  });
  await assert.rejects(
    client.rpc("execute_paper_market_order", { p_user_id: USER_UUID }),
    error => error.status === 503 &&
      error.code === "SUPABASE_REQUEST_REJECTED" &&
      !error.message.includes("private SQL detail")
  );
});

test("sanitizes network failures", async () => {
  const client = createSupabaseRestClient({
    url: BASE_URL,
    serviceRoleKey: SERVICE_KEY,
    fetchImpl: async () => { throw new Error("secret network detail"); }
  });
  await assert.rejects(
    client.resolveFirebaseUid("legacy-user"),
    error => error.status === 503 &&
      error.code === "SUPABASE_REQUEST_FAILED" &&
      !error.message.includes("secret network detail")
  );
});

test("rejects invalid Firebase UIDs before making a request", async () => {
  let called = false;
  const client = createSupabaseRestClient({
    url: BASE_URL,
    serviceRoleKey: SERVICE_KEY,
    fetchImpl: async () => { called = true; return fakeResponse(); }
  });
  await assert.rejects(
    client.resolveFirebaseUid("   "),
    error => error.status === 401 && error.code === "FIREBASE_IDENTITY_INVALID"
  );
  assert.equal(called, false);
});

test("rejects unsafe RPC names and malformed payloads", async () => {
  const client = createSupabaseRestClient({
    url: BASE_URL,
    serviceRoleKey: SERVICE_KEY,
    fetchImpl: async () => fakeResponse()
  });
  await assert.rejects(
    client.rpc("execute_paper_market_order;drop_table", {}),
    error => error.status === 400 && error.code === "SUPABASE_RPC_INPUT_INVALID"
  );
  await assert.rejects(
    client.rpc("execute_paper_market_order", []),
    error => error.status === 400 && error.code === "SUPABASE_RPC_INPUT_INVALID"
  );
});

test("requires HTTPS and a server-side service-role credential", () => {
  assert.throws(
    () => createSupabaseRestClient({ url: "http://example.supabase.co", serviceRoleKey: SERVICE_KEY }),
    error => error.code === "SUPABASE_CONFIG_INVALID"
  );
  assert.throws(
    () => createSupabaseRestClient({ url: BASE_URL, serviceRoleKey: "short" }),
    error => error.code === "SUPABASE_CONFIG_INVALID"
  );
});
