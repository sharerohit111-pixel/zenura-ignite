"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BROKER_CATALOG,
  EXCLUDED_BROKERS,
  getBrokerCatalog,
  getBrokerById,
} = require("../lib/broker-catalog");

test("catalog contains only the selected no-paid-data-API broker candidates", () => {
  assert.deepEqual(BROKER_CATALOG.map((broker) => broker.id), [
    "upstox", "fyers", "angel_one",
  ]);
  assert.deepEqual(EXCLUDED_BROKERS, ["dhan", "zerodha"]);
  assert.equal(BROKER_CATALOG.every((broker) => broker.liveFeedEnabledByDefault === false), true);
  assert.equal(BROKER_CATALOG.every((broker) => broker.requiresPerUserToken === true), true);
});

test("affiliate URL is optional and falls back to official account opening URL", () => {
  const [upstox] = getBrokerCatalog();
  assert.equal(upstox.referralUrl, null);
  assert.equal(upstox.accountOpeningLinkType, "official");
  assert.equal(upstox.accountOpeningUrl, "https://upstox.com/");
});

test("approved HTTPS affiliate URL is exposed separately from official URL", () => {
  const broker = getBrokerById("fyers", {
    referralUrls: { fyers: "https://partner.example/fyers?ref=approved" },
  });
  assert.equal(broker.referralUrl, "https://partner.example/fyers?ref=approved");
  assert.equal(broker.accountOpeningLinkType, "affiliate");
  assert.equal(broker.accountOpeningUrl, "https://fyers.in/");
});

test("rejects non-HTTPS or malformed affiliate URLs", () => {
  assert.throws(() => getBrokerCatalog({
    referralUrls: { upstox: "http://unsafe.example/ref" },
  }), /HTTPS/);
  assert.throws(() => getBrokerCatalog({
    referralUrls: { fyers: "not-a-url" },
  }), /absolute HTTPS/);
});

test("unknown and excluded brokers are not returned", () => {
  assert.equal(getBrokerById("dhan"), null);
  assert.equal(getBrokerById("zerodha"), null);
  assert.equal(getBrokerById("kotak_neo"), null);
});
