"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { getBrokerAuthContract, buildAuthorizationUrl } = require("../lib/broker-oauth-contract");
test("Dhan and Zerodha remain excluded from broker OAuth contracts", () => {
  assert.equal(getBrokerAuthContract("dhan"), null);
  assert.equal(getBrokerAuthContract("zerodha"), null);
});
test("Upstox and FYERS expose authorization-code metadata", () => {
  assert.equal(getBrokerAuthContract("upstox").mode, "authorization_code");
  assert.equal(getBrokerAuthContract("fyers").refreshValidityDays, 15);
  const url = new URL(buildAuthorizationUrl({ brokerId:"upstox", clientId:"client", redirectUri:"https://app.example/callback", state:"opaque-state" }));
  assert.equal(url.searchParams.get("state"), "opaque-state");
  assert.equal(url.searchParams.get("client_id"), "client");
});
test("Angel One does not get forced into a generic OAuth URL", () => {
  assert.equal(getBrokerAuthContract("angel_one").mode, "smartapi_session");
  assert.throws(() => buildAuthorizationUrl({ brokerId:"angel_one", clientId:"c", redirectUri:"https://x", state:"s" }));
});
