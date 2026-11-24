"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeUpstoxNseFuturesMaster,
  selectNseFuturesContract
} = require("../lib/nse-futures-instrument-master");

const NOW = Date.UTC(2026, 10, 24, 6, 0, 0);
const future = (patch = {}) => ({
  instrument_key: "NSE_FO|NIFTY26NOVFUT",
  trading_symbol: "NIFTY 26 NOV FUT",
  underlying_symbol: "NIFTY",
  exchange: "NSE",
  segment: "NSE_FO",
  instrument_type: "FUT",
  expiry: "2026-11-26",
  lot_size: 65,
  tick_size: 5,
  ...patch
});

test("normalizes only valid NSE Futures rows into immutable provider-neutral fields", () => {
  const result = normalizeUpstoxNseFuturesMaster([
    future(),
    future({ instrument_key: "NSE_FO|BANKNIFTY26NOVFUT", trading_symbol: "BANKNIFTY FUT", underlying_symbol: "BANKNIFTY", lot_size: 30 }),
    { ...future(), exchange: "BSE", segment: "BSE_FO" },
    { ...future(), segment: "NSE_EQ", instrument_type: "EQ" }
  ], { nowMs: NOW });

  assert.equal(result.contractCount, 2);
  assert.equal(result.ignoredCount, 2);
  assert.equal(result.provider, "UPSTOX");
  assert.equal(result.contracts[0].instrumentKey, "NSE_FO|BANKNIFTY26NOVFUT");
  assert.equal(result.contracts[1].tickSizePaise, 5);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.contracts) && Object.isFrozen(result.contracts[0]));
  assert.equal("access_token" in result.contracts[0], false);
});

test("drops contracts at or after the NSE expiry-day 15:30 IST cutoff", () => {
  const cutoff = Date.UTC(2026, 10, 26, 10, 0, 0);
  const before = normalizeUpstoxNseFuturesMaster([future()], { nowMs: cutoff - 1 });
  const at = normalizeUpstoxNseFuturesMaster([future()], { nowMs: cutoff });
  assert.equal(before.contractCount, 1);
  assert.equal(at.contractCount, 0);
  assert.equal(at.expiredCount, 1);
});

test("rejects malformed NSE Futures contract rows and duplicate instrument keys", () => {
  for (const patch of [
    { instrument_key: "BSE_FO|NIFTY26NOVFUT" },
    { trading_symbol: "" },
    { underlying_symbol: null },
    { expiry: "2026-02-30" },
    { lot_size: 0 },
    { tick_size: 0 }
  ]) {
    assert.throws(
      () => normalizeUpstoxNseFuturesMaster([future(patch)], { nowMs: NOW }),
      { status: 422 }
    );
  }
  assert.throws(
    () => normalizeUpstoxNseFuturesMaster([future(), future()], { nowMs: NOW }),
    /duplicate instrument key/
  );
});

test("selects nearest listed expiry and supports an explicit expiry", () => {
  const master = normalizeUpstoxNseFuturesMaster([
    future({ instrument_key: "NSE_FO|NIFTY27JANFUT", trading_symbol: "NIFTY JAN FUT", expiry: "2027-01-28" }),
    future({ instrument_key: "NSE_FO|NIFTY24DEC26FUT", trading_symbol: "NIFTY DEC FUT", expiry: "2026-12-31" }),
    future({ instrument_key: "NSE_FO|BANKNIFTY24DEC26FUT", trading_symbol: "BANKNIFTY DEC FUT", underlying_symbol: "BANKNIFTY", expiry: "2026-12-31" })
  ], { nowMs: NOW });

  assert.equal(selectNseFuturesContract(master, { underlyingSymbol: "nifty" }).expiry, "2026-12-31");
  assert.equal(
    selectNseFuturesContract(master, { underlyingSymbol: "NIFTY", expiry: "2027-01-28" }).instrumentKey,
    "NSE_FO|NIFTY27JANFUT"
  );
  assert.throws(
    () => selectNseFuturesContract(master, { underlyingSymbol: "NIFTY", expiry: "2026-11-26" }),
    /No eligible/
  );
});

test("requires explicit underlying identity and valid master timestamps", () => {
  assert.throws(() => normalizeUpstoxNseFuturesMaster([], { nowMs: NOW }), /non-empty/);
  assert.throws(() => normalizeUpstoxNseFuturesMaster([future()], { nowMs: 0 }), /valid timestamp/);
  assert.throws(() => selectNseFuturesContract(null, { underlyingSymbol: "NIFTY" }), /normalized Futures master/);
  const master = normalizeUpstoxNseFuturesMaster([future()], { nowMs: NOW });
  assert.throws(() => selectNseFuturesContract(master, {}), /explicit underlying/);
});
