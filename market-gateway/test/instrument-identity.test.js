"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeInstrumentRecord, buildInstrumentMaster, buildProviderSymbolMap } = require("../lib/instrument-identity");

const NOW = 1_795_478_400_000;
const META = {
  providerId: "upstox", exchange: "NSE", generatedAtMs: NOW - 1000,
  sourceDate: "2026-11-24", sourceReference: "official-provider-master",
  sourceSha256: "a".repeat(64), nowMs: NOW,
};
function equity(overrides = {}) {
  return {
    segment: "NSE_EQ", instrumentType: "EQUITY", providerInstrumentKey: "NSE_EQ|INE123456789",
    providerSymbol: "ABC-EQ", symbol: "ABC", isin: "INE123456789",
    tickSizePaise: 5, lotSize: 1, ...overrides,
  };
}
function future(overrides = {}) {
  return {
    segment: "NSE_FO", instrumentType: "FUTURE", providerInstrumentKey: "NSE_FO|ABC-FUT",
    providerSymbol: "ABC FUT", symbol: "ABC", underlyingInstrumentId: "EQ:NSE:INE123456789",
    expiryDate: "2026-12-31", tickSizePaise: 5, lotSize: 500, ...overrides,
  };
}
test("canonical equity identity is exchange-scoped and ISIN-based", () => {
  const nse = normalizeInstrumentRecord(equity(), { providerId: "upstox", exchange: "NSE" });
  const bse = normalizeInstrumentRecord(equity({ segment: "BSE_EQ", providerInstrumentKey: "BSE_EQ|500001" }), { providerId: "kite", exchange: "BSE" });
  assert.equal(nse.instrumentId, "EQ:NSE:INE123456789");
  assert.equal(bse.instrumentId, "EQ:BSE:INE123456789");
});
test("derivative identities are contract-specific and independent of provider symbols", () => {
  const a = normalizeInstrumentRecord(future(), { providerId: "upstox", exchange: "NSE" });
  const b = normalizeInstrumentRecord(future({ providerInstrumentKey: "NFO|ABC26DEC", providerSymbol: "ABC26DECFUT" }), { providerId: "kite", exchange: "NSE" });
  assert.equal(a.instrumentId, b.instrumentId);
  const option = normalizeInstrumentRecord(future({
    instrumentType: "OPTION", providerInstrumentKey: "NSE_FO|ABC-CE",
    providerSymbol: "ABC CE", optionType: "CE", strikePricePaise: 125000,
  }), { providerId: "upstox", exchange: "NSE" });
  assert.match(option.instrumentId, /:CE:125000$/);
});
test("rejects invalid exchange segment, ISIN, option contract and lot/tick sizes", () => {
  assert.throws(() => normalizeInstrumentRecord(equity({ isin: "BAD" }), { providerId: "upstox", exchange: "NSE" }));
  assert.throws(() => normalizeInstrumentRecord(equity({ segment: "NSE_FO" }), { providerId: "upstox", exchange: "BSE" }));
  assert.throws(() => normalizeInstrumentRecord(future({ lotSize: 0 }), { providerId: "upstox", exchange: "NSE" }));
  assert.throws(() => normalizeInstrumentRecord(future({ instrumentType: "OPTION", optionType: "XX", strikePricePaise: 0 }), { providerId: "upstox", exchange: "NSE" }));
});
test("builds a provenance-bound master and rejects stale, future or duplicate identities", () => {
  const master = buildInstrumentMaster({ ...META, records: [equity()] });
  assert.equal(master.instrumentCount, 1);
  assert.equal(master.instruments[0].instrumentId, "EQ:NSE:INE123456789");
  assert.throws(() => buildInstrumentMaster({ ...META, generatedAtMs: NOW + 1, records: [equity()] }));
  assert.throws(() => buildInstrumentMaster({ ...META, sourceDate: "2026-11-25", records: [equity()] }));
  assert.throws(() => buildInstrumentMaster({ ...META, sourceDate: "2026-11-01", records: [equity()] }));
  assert.throws(() => buildInstrumentMaster({ ...META, records: [equity(), equity({ providerInstrumentKey: "another-key" })] }));
});
test("maps provider-specific symbols to the same canonical identity", () => {
  const upstox = buildInstrumentMaster({ ...META, records: [equity()] });
  const kite = buildInstrumentMaster({
    ...META, providerId: "kite",
    records: [equity({ providerInstrumentKey: "NSE|12345", providerSymbol: "ABC" })],
  });
  const mappings = buildProviderSymbolMap([upstox, kite]);
  assert.equal(mappings.length, 2);
  assert.equal(mappings[0].instrumentId, mappings[1].instrumentId);
  assert.throws(() => buildProviderSymbolMap([upstox, upstox]), /Duplicate provider mapping key/);
});
