"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { rankInstrumentSearchResults } = require("../lib/instrument-search");

const rows = [
  { instrument_key: "NSE_EQ|Z", trading_symbol: "ZOMATO", name: "Eternal Ltd" },
  { instrument_key: "NSE_EQ|TCS", trading_symbol: "TCS", name: "Tata Consultancy Services" },
  { instrument_key: "NSE_EQ|TCSIND", trading_symbol: "TCSIND", name: "TCS Industries Ltd" },
  { instrument_key: "NSE_EQ|XTCS", trading_symbol: "XTCS", name: "Example Holdings Ltd" },
  { instrument_key: "NSE_EQ|TATACOMM", trading_symbol: "TATACOMM", name: "Tata Communications Ltd" },
  { instrument_key: "NSE_EQ|TATAMOTORS", trading_symbol: "TATAMOTORS", name: "Tata Motors Ltd" },
  { instrument_key: "NSE_EQ|TATASTEEL", trading_symbol: "TATASTEEL", name: "Tata Steel Ltd" },
  { instrument_key: "NSE_EQ|MISC", trading_symbol: "MISC", name: "Tata Group Tracker" }
];

test("exact trading-symbol match ranks before prefix and substring matches", () => {
  const result = rankInstrumentSearchResults(rows, "tcs", 10);
  assert.deepEqual(result.slice(0, 3).map(x => x.trading_symbol), ["TCS", "TCSIND", "XTCS"]);
});

test("symbol prefixes rank before name and underlying matches", () => {
  const result = rankInstrumentSearchResults(rows, "tata", 10);
  assert.deepEqual(result.slice(0, 3).map(x => x.trading_symbol), ["TATACOMM", "TATAMOTORS", "TATASTEEL"]);
  assert.ok(result.findIndex(x => x.instrument_key === "NSE_EQ|MISC") > 2);
});

test("search is case-insensitive, trims whitespace, and preserves input order for empty query", () => {
  assert.equal(rankInstrumentSearchResults(rows, "  ZOMATO ", 10)[0].trading_symbol, "ZOMATO");
  assert.deepEqual(rankInstrumentSearchResults(rows, "", 3), rows.slice(0, 3));
});

test("limit is enforced and invalid limits fail closed", () => {
  assert.equal(rankInstrumentSearchResults(rows, "tata", 2).length, 2);
  assert.throws(() => rankInstrumentSearchResults(rows, "tata", 0), RangeError);
  assert.throws(() => rankInstrumentSearchResults({}, "tata", 10), TypeError);
});

test("nonmatching instruments are excluded", () => {
  assert.deepEqual(rankInstrumentSearchResults(rows, "not-a-stock", 10), []);
});
