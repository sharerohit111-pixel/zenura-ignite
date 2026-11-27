"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { checkSupabaseReadiness } = require("../lib/supabase-readiness");

test("readiness probes Supabase Auth and Data API using read-only GET requests", async () => {
  const calls = [];
  const result = await checkSupabaseReadiness({
    supabaseUrl: "https://example-project.supabase.co",
    publishableKey: "sb_publishable_disposable_test",
    timeoutMs: 500,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    }
  });

  assert.deepEqual(result, { authApi: true, dataApi: true });
  assert.deepEqual(calls.map(call => call.url).sort(), [
    "https://example-project.supabase.co/auth/v1/health",
    "https://example-project.supabase.co/rest/v1/"
  ]);
  for (const call of calls) {
    assert.equal(call.options.method, "GET");
    assert.equal(call.options.headers.apikey, "sb_publishable_disposable_test");
    assert.equal(call.options.headers.Accept, "application/json");
    assert.ok(call.options.signal instanceof AbortSignal);
  }
});

test("readiness reports a failed dependency without exposing response details", async () => {
  const result = await checkSupabaseReadiness({
    supabaseUrl: "https://example-project.supabase.co",
    publishableKey: "disposable",
    fetchImpl: async url => ({ ok: !url.endsWith("/rest/v1/"), status: 503 })
  });
  assert.deepEqual(result, { authApi: true, dataApi: false });
});

test("readiness fails closed for invalid configuration without making requests", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true }; };
  assert.deepEqual(await checkSupabaseReadiness({
    supabaseUrl: "http://example-project.supabase.co",
    publishableKey: "disposable",
    fetchImpl
  }), { authApi: false, dataApi: false });
  assert.deepEqual(await checkSupabaseReadiness({
    supabaseUrl: "https://example-project.supabase.co",
    publishableKey: "",
    fetchImpl
  }), { authApi: false, dataApi: false });
  assert.equal(calls, 0);
});

test("readiness converts network failures and timeouts into false dependency checks", async () => {
  const result = await checkSupabaseReadiness({
    supabaseUrl: "https://example-project.supabase.co",
    publishableKey: "disposable",
    timeoutMs: 100,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })
  });
  assert.deepEqual(result, { authApi: false, dataApi: false });
});
