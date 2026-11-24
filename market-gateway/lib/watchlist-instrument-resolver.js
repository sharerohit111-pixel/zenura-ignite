"use strict";

function buildMockWatchlistCatalog(marketFixture, derivativesFixture) {
  const validEnvelope = value => value && value.schemaVersion === "1.0.0" &&
    value.mode === "MOCK" && value.simulated === true &&
    value.meta?.source === "SYNTHETIC_FIXTURE";
  if (!validEnvelope(marketFixture) || !validEnvelope(derivativesFixture)) {
    throw new Error("INVALID_CANONICAL_MOCK_WATCHLIST_FIXTURE");
  }
  const result = new Map();
  const add = item => {
    if (!item || typeof item.instrumentKey !== "string" ||
        !item.instrumentKey.startsWith("MOCK|") || typeof item.symbol !== "string" ||
        !["NSE", "BSE"].includes(item.exchange) || result.has(item.instrumentKey)) {
      throw new Error("INVALID_OR_DUPLICATE_CANONICAL_MOCK_INSTRUMENT");
    }
    result.set(item.instrumentKey, Object.freeze({
      instrument_key: item.instrumentKey,
      segment: item.assetClass === "INDEX" ? item.exchange + "_INDEX" :
        item.assetClass === "EQUITY" ? item.exchange + "_EQ" : item.exchange + "_FO",
      exchange: item.exchange,
      trading_symbol: item.symbol,
      name: item.symbol,
      instrument_type: item.assetClass,
      expiry: item.expiry ?? null,
      strike_price: item.strikePaise == null ? null : item.strikePaise / 100,
      lot_size: item.lotSize ?? null,
      tick_size: item.tickSizePaise == null ? null : item.tickSizePaise / 100,
      underlying_symbol: item.underlying ?? null,
      simulated: true
    }));
  };
  for (const quote of marketFixture.data?.quotes || []) {
    const [, exchange, segment] = String(quote.instrumentKey || "").split("|");
    add({instrumentKey:quote.instrumentKey,symbol:quote.symbol,exchange,
      assetClass:segment === "INDEX" ? "INDEX" : "EQUITY"});
  }
  for (const contract of derivativesFixture.data?.contracts || []) {
    add({instrumentKey:contract.instrumentKey,symbol:contract.symbol,exchange:contract.exchange,
      assetClass:contract.assetClass,expiry:contract.expiry,strikePaise:contract.strikePaise,
      lotSize:contract.lotSize,tickSizePaise:contract.tickSizePaise,underlying:contract.underlying});
  }
  return result;
}

function resolveWatchlistInstrument(instrumentKey, officialInstruments, mockCatalog) {
  const official = officialInstruments.find(item => item.instrument_key === instrumentKey);
  if (official) return official;
  return mockCatalog.get(instrumentKey) || null;
}

module.exports = {buildMockWatchlistCatalog, resolveWatchlistInstrument};
