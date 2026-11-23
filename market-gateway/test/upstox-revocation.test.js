"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {revokeUpstoxAccessToken} = require("../lib/upstox-revocation");

function response({ok = true, payload = {status:"success",data:true}} = {}) {
  return {ok, payload};
}

test("calls the fixed Upstox logout endpoint with DELETE and bearer token", async () => {
  const calls = [];
  const result = await revokeUpstoxAccessToken("opaque-token", {
    fetchProvider: async (url, options) => {
      calls.push({url, options});
      return response();
    },
    readProviderJson: async value => value.payload
  });
  assert.equal(result, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.upstox.com/v2/logout");
  assert.equal(calls[0].options.method, "DELETE");
  assert.equal(calls[0].options.headers.Authorization, "Bearer opaque-token");
});

test("returns false for upstream errors, malformed responses and network failures", async () => {
  const read = async value => value.payload;
  assert.equal(await revokeUpstoxAccessToken("opaque-token", {
    fetchProvider: async () => response({ok:false}), readProviderJson:read
  }), false);
  assert.equal(await revokeUpstoxAccessToken("opaque-token", {
    fetchProvider: async () => response({payload:{status:"error",data:false}}), readProviderJson:read
  }), false);
  assert.equal(await revokeUpstoxAccessToken("opaque-token", {
    fetchProvider: async () => { throw new Error("network"); }, readProviderJson:read
  }), false);
});

test("does not call the provider for invalid tokens or dependencies", async () => {
  let calls = 0;
  const deps = {fetchProvider:async()=>{calls++;return response();},readProviderJson:async x=>x.payload};
  for (const token of ["", "  ", null, 42]) {
    assert.equal(await revokeUpstoxAccessToken(token,deps), false);
  }
  assert.equal(await revokeUpstoxAccessToken("token",{fetchProvider:deps.fetchProvider}),false);
  assert.equal(calls,0);
});
