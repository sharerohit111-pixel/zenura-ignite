"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createMockFixtureStore } = require("../lib/paper-mock-fixtures");

const store = () => createMockFixtureStore({ env: { NODE_ENV: "test" } });

test("all published mock fixtures use the shared simulated envelope", () => {
  const fixtures = store();
  for (const name of fixtures.names()) {
    const fixture = fixtures.read(name);
    assert.equal(fixture.schemaVersion, "1.0.0");
    assert.equal(fixture.mode, "MOCK");
    assert.equal(fixture.simulated, true);
    assert.ok(fixture.requestId);
    assert.ok(Number.isFinite(Date.parse(fixture.asOf)));
    assert.equal(typeof fixture.data, "object");
  }
});

test("shared JSON schemas parse and define the expected domain contracts", () => {
  const root = path.join(__dirname, "..", "mock", "contracts");
  const envelope = JSON.parse(fs.readFileSync(path.join(root, "paper-trading-envelope.schema.json"), "utf8"));
  const domain = JSON.parse(fs.readFileSync(path.join(root, "paper-trading-domain.schema.json"), "utf8"));
  assert.equal(envelope.properties.schemaVersion.const, "1.0.0");
  assert.equal(envelope.properties.simulated.const, true);
  for (const key of ["instrument", "quote", "order", "position", "account", "derivativeInstrument", "derivativeQuote"]) {
    assert.ok(domain.$defs[key], "missing domain definition: " + key);
  }
  assert.equal(domain.$defs.exchange.enum.join(","), "NSE,BSE");
  assert.equal(domain.$defs.orderType.enum.join(","), "MARKET,LIMIT");
  assert.equal(domain.$defs.side.enum.join(","), "BUY,SELL");
});

test("account fixture keeps virtual starting capital at INR 10 lakh in paise", () => {
  const account = store().read("account").data;
  assert.equal(account.currency, "INR");
  assert.equal(account.startingCapitalPaise, 100000000);
  assert.equal(account.ledgerReconciled, false);
  assert.equal(account.availableFundsPaise + account.blockedFundsPaise, account.cashBalancePaise);
});

test("market fixture contains only explicitly synthetic quote data", () => {
  const market = store().read("market").data;
  assert.ok(["NSE", "BSE"].includes(market.exchange));
  assert.ok(market.quotes.length > 0);
  for (const quote of market.quotes) {
    assert.equal(quote.provider, "MOCK");
    assert.equal(quote.stale, false);
    assert.ok(quote.instrumentKey.startsWith("MOCK|"));
    assert.ok(Number.isInteger(quote.lastPricePaise));
    assert.ok(Number.isFinite(Date.parse(quote.timestamp)));
  }
});

test("equity and derivatives fixtures expose supported order enums and integer prices", () => {
  const equity = store().read("equity").data;
  const derivatives = store().read("derivatives").data;
  for (const order of [equity.order, derivatives.futures.order, derivatives.options.order]) {
    assert.ok(["BUY", "SELL"].includes(order.side));
    assert.ok(["MARKET", "LIMIT"].includes(order.orderType));
    assert.ok(["PENDING", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED", "EXPIRED"].includes(order.status));
  }
  assert.ok(["INTRADAY", "DELIVERY"].includes(equity.product));
  assert.ok(["CE", "PE"].includes(derivatives.options.optionType));
  assert.ok(Number.isInteger(equity.order.averagePricePaise));
  assert.ok(Number.isInteger(derivatives.options.order.averagePricePaise));
});

test("unknown fixture names fail closed, including Crypto", () => {
  const fixtures = store();
  assert.throws(() => fixtures.read("crypto"), /UNKNOWN_MOCK_FIXTURE/);
});

test("mock fixture store cannot be created in production", () => {
  assert.throws(
    () => createMockFixtureStore({ env: { NODE_ENV: "production" } }),
    /MOCK_FIXTURES_DISABLED_IN_PRODUCTION/
  );
});

test("malformed fixture envelopes fail closed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zenura-mock-"));
  try {
    fs.writeFileSync(path.join(root, "market.json"), JSON.stringify({
      schemaVersion: "1.0.0", mode: "MOCK", simulated: false,
      requestId: "bad", asOf: new Date().toISOString(), data: {}
    }));
    const fixtures = createMockFixtureStore({ env: { NODE_ENV: "test" }, root });
    assert.throws(() => fixtures.read("market"), /INVALID_MOCK_FIXTURE_ENVELOPE/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("returned fixtures are detached copies", () => {
  const fixtures = store();
  const first = fixtures.read("market");
  first.data.quotes[0].symbol = "MUTATED";
  assert.equal(fixtures.read("market").data.quotes[0].symbol, "MOCKALPHA");
});


test("derivatives fixture contains deterministic MOCK-only Futures and CE/PE contracts", () => {
  const fixture = store().read("derivatives").data;
  assert.ok(fixture.contracts.length >= 8);
  assert.equal(fixture.quotes.length, fixture.contracts.length);
  assert.ok(fixture.contracts.every(item => item.instrumentKey.startsWith("MOCK|") && item.symbol.startsWith("MOCK")));
  assert.ok(fixture.contracts.some(item => item.assetClass === "FUTURE"));
  assert.ok(fixture.contracts.some(item => item.assetClass === "OPTION" && item.optionType === "CE"));
  assert.ok(fixture.contracts.some(item => item.assetClass === "OPTION" && item.optionType === "PE"));
});
