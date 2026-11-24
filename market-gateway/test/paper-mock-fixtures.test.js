"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockFixtureStore } = require("../lib/paper-mock-fixtures");

test("all published mock fixtures use the shared simulated envelope", () => {
  const store = createMockFixtureStore({ env: { NODE_ENV: "test" } });
  for (const name of store.names()) {
    const fixture = store.read(name);
    assert.equal(fixture.schemaVersion, "1.0.0");
    assert.equal(fixture.mode, "MOCK");
    assert.equal(fixture.simulated, true);
    assert.ok(fixture.requestId);
    assert.ok(fixture.asOf);
    assert.equal(typeof fixture.data, "object");
  }
});

test("account fixture keeps virtual starting capital at INR 10 lakh in paise", () => {
  const account = createMockFixtureStore({ env: { NODE_ENV: "test" } }).read("account").data;
  assert.equal(account.currency, "INR");
  assert.equal(account.startingCapitalPaise, 100000000);
  assert.equal(account.ledgerReconciled, false);
});

test("unknown fixture names fail closed", () => {
  const store = createMockFixtureStore({ env: { NODE_ENV: "test" } });
  assert.throws(() => store.read("crypto"), /UNKNOWN_MOCK_FIXTURE/);
});

test("mock fixture store cannot be created in production", () => {
  assert.throws(
    () => createMockFixtureStore({ env: { NODE_ENV: "production" } }),
    /MOCK_FIXTURES_DISABLED_IN_PRODUCTION/
  );
});

test("returned fixtures are detached copies", () => {
  const store = createMockFixtureStore({ env: { NODE_ENV: "test" } });
  const first = store.read("market");
  first.data.quotes[0].symbol = "MUTATED";
  assert.equal(store.read("market").data.quotes[0].symbol, "MOCKALPHA");
});
