"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSupabaseRuntime, readBearerToken } = require("../lib/supabase-runtime");

const uid = "11111111-2222-4333-8444-555555555555";
const accessToken = "verified-supabase-access-token";
function fakeFactory(calls) {
  return (url, key, options) => {
    calls.push({ url, key, options });
    return {
      auth: { getUser: async token => token === accessToken
        ? { data: { user: { id: uid, email: "user@example.test" } }, error: null }
        : { data: { user: null }, error: { message: "invalid token" } } },
      rpc: async (name, args) => ({ data: { name, args }, error: null })
    };
  };
}
const config = {
  supabaseUrl: "https://project.supabase.co",
  publishableKey: "sb_publishable_public_test",
  serviceRoleKey: "server-only-secret-test"
};

test("requires HTTPS project URL, publishable key, service key and client factory", () => {
  assert.throws(() => createSupabaseRuntime({ ...config, supabaseUrl: "http://project.supabase.co", createClient: () => ({}) }), /HTTPS/);
  assert.throws(() => createSupabaseRuntime({ ...config, serviceRoleKey: "", createClient: () => ({}) }), /service-role/);
  assert.throws(() => createSupabaseRuntime({ ...config, createClient: undefined }), /factory/);
});

test("accepts only a Bearer token and verifies it with Supabase Auth getUser", async () => {
  const calls = [];
  const runtime = createSupabaseRuntime({ ...config, createClient: fakeFactory(calls) });
  await assert.rejects(runtime.authenticateRequest({ get: () => "" }), { status: 401 });
  const user = await runtime.authenticateRequest({ get: () => "Bearer " + accessToken });
  assert.deepEqual(user, { id: uid, email: "user@example.test", emailConfirmedAt: null });
  assert.equal(calls[0].key, config.serviceRoleKey);
});

test("user-scoped reads use publishable key plus the user's JWT, never the service key", () => {
  const calls = [];
  const runtime = createSupabaseRuntime({ ...config, createClient: fakeFactory(calls) });
  runtime.createUserClient(accessToken);
  assert.equal(calls[1].key, config.publishableKey);
  assert.equal(calls[1].options.global.headers.Authorization, "Bearer " + accessToken);
  assert.equal(JSON.stringify(calls[1]).includes(config.serviceRoleKey), false);
});

test("server RPC always injects verified user UUID and rejects caller-selected identity", async () => {
  const calls = [];
  const runtime = createSupabaseRuntime({ ...config, createClient: fakeFactory(calls) });
  const user = await runtime.authenticateRequest({ get: () => "Bearer " + accessToken });
  const result = await runtime.callUserRpc(user, "initialize_paper_trading_account", {});
  assert.equal(result.args.p_user_id, uid);
  await assert.rejects(runtime.callUserRpc(user, "initialize_paper_trading_account", { p_user_id: "22222222-2222-4222-8222-222222222222" }), { status: 400 });
  await assert.rejects(runtime.callUserRpc(user, "unknown_rpc", {}), { status: 400 });
});

test("does not accept an invalid or non-UUID Auth identity", async () => {
  const factory = (url, key, options) => ({
    auth: { getUser: async () => ({ data: { user: { id: "not-a-uuid" } }, error: null }) },
    rpc: async () => ({ data: null, error: null })
  });
  const runtime = createSupabaseRuntime({ ...config, createClient: factory });
  await assert.rejects(runtime.authenticateRequest({ get: () => "Bearer " + accessToken }), { status: 401 });
});

test("allowlists only the two S-TRADE crypto transactional RPCs", async () => {
  const calls = [];
  const runtime = createSupabaseRuntime({ ...config, createClient: fakeFactory(calls) });
  const user = await runtime.authenticateRequest({ get: () => "Bearer " + accessToken });
  const initialized = await runtime.callUserRpc(user, "initialize_paper_crypto_account", {
    p_starting_cash_usdt: "10000"
  });
  assert.equal(initialized.args.p_user_id, uid);
  assert.equal(initialized.args.p_starting_cash_usdt, "10000");
  const order = await runtime.callUserRpc(user, "execute_paper_crypto_market_order", {
    p_order_id: "11111111-2222-4333-8444-555555555556",
    p_idempotency_key: "11111111-2222-4333-8444-555555555557"
  });
  assert.equal(order.args.p_user_id, uid);
  await assert.rejects(
    runtime.callUserRpc(user, "execute_paper_crypto_market_order", {
      p_user_id: "22222222-2222-4222-8222-222222222222"
    }),
    { status: 400 }
  );
  await assert.rejects(
    runtime.callUserRpc(user, "execute_paper_crypto_unknown", {}),
    { status: 400 }
  );
});
