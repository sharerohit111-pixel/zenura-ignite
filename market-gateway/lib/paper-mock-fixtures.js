"use strict";

const fs = require("node:fs");
const path = require("node:path");

const FIXTURES = Object.freeze({
  market: "market.json",
  account: "account.json",
  equity: "equity.json",
  derivatives: "derivatives.json",
  error: "error.json"
});

function createMockFixtureStore(options = {}) {
  const env = options.env || process.env;
  if (env.NODE_ENV === "production") {
    throw new Error("MOCK_FIXTURES_DISABLED_IN_PRODUCTION");
  }

  const root = options.root || path.join(__dirname, "..", "mock", "fixtures");
  function read(name) {
    const filename = FIXTURES[name];
    if (!filename) throw new Error("UNKNOWN_MOCK_FIXTURE");
    const raw = fs.readFileSync(path.join(root, filename), "utf8");
    const value = JSON.parse(raw);
    if (value.schemaVersion !== "1.0.0" || value.mode !== "MOCK" || value.simulated !== true ||
        typeof value.requestId !== "string" || typeof value.asOf !== "string" ||
        !value.data || typeof value.data !== "object" || Array.isArray(value.data)) {
      throw new Error("INVALID_MOCK_FIXTURE_ENVELOPE");
    }
    return JSON.parse(JSON.stringify(value));
  }

  return Object.freeze({
    names: () => Object.keys(FIXTURES),
    read
  });
}

module.exports = { createMockFixtureStore, MOCK_FIXTURE_NAMES: Object.keys(FIXTURES) };
