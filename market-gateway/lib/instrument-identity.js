"use strict";

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{10}$/;
const PROVIDER_RE = /^[a-z][a-z0-9_-]{1,39}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SEGMENTS = Object.freeze({
  NSE: new Set(["NSE_EQ", "NSE_FO"]),
  BSE: new Set(["BSE_EQ", "BSE_FO"]),
});

function fail(message, code = "invalid_instrument_master") {
  throw Object.assign(new Error(message), { code, status: 422 });
}
function requiredText(value, label, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail(label + " is missing or invalid.");
  return value.trim();
}
function validDate(value, label) {
  if (typeof value !== "string" || !DATE_RE.test(value) ||
      Number.isNaN(Date.parse(value + "T00:00:00Z")) ||
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) fail(label + " must be a real YYYY-MM-DD date.");
  return value;
}
function canonicalInstrumentId(record) {
  const exchange = record.exchange;
  if (record.instrumentType === "EQUITY") {
    if (!ISIN_RE.test(record.isin || "")) fail("Equity instrument requires a valid ISIN.");
    return "EQ:" + exchange + ":" + record.isin;
  }
  const underlying = requiredText(record.underlyingInstrumentId, "Derivative underlying instrument identity", 180);
  const expiry = validDate(record.expiryDate, "Derivative expiry");
  if (record.instrumentType === "FUTURE") return ["FUT", exchange, record.segment, underlying, expiry].join(":");
  if (record.instrumentType === "OPTION") {
    if (!["CE", "PE"].includes(record.optionType) ||
        !Number.isSafeInteger(record.strikePricePaise) || record.strikePricePaise <= 0) {
      fail("Option contract requires CE/PE and a positive integer-paise strike.");
    }
    return ["OPT", exchange, record.segment, underlying, expiry, record.optionType, record.strikePricePaise].join(":");
  }
  fail("Unsupported instrument type.");
}
function normalizeInstrumentRecord(input, { providerId, exchange } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Instrument record is missing.");
  if (!PROVIDER_RE.test(providerId || "") || !["NSE", "BSE"].includes(exchange)) fail("Provider or exchange identity is invalid.");
  const segment = requiredText(input.segment, "Instrument segment", 24).toUpperCase();
  if (!SEGMENTS[exchange].has(segment)) fail("Instrument segment does not belong to the declared exchange.");
  const instrumentType = requiredText(input.instrumentType, "Instrument type", 16).toUpperCase();
  if (!["EQUITY", "FUTURE", "OPTION"].includes(instrumentType)) fail("Instrument type is unsupported.");
  const providerInstrumentKey = requiredText(input.providerInstrumentKey, "Provider instrument key", 160);
  const providerSymbol = requiredText(input.providerSymbol, "Provider symbol", 120);
  const symbol = requiredText(input.symbol, "Canonical trading symbol", 120).toUpperCase();
  const tickSizePaise = input.tickSizePaise;
  const lotSize = input.lotSize;
  if (!Number.isSafeInteger(tickSizePaise) || tickSizePaise <= 0 ||
      !Number.isSafeInteger(lotSize) || lotSize <= 0) fail("Tick size and lot size must be positive safe integers.");
  const normalized = {
    exchange, segment, instrumentType, symbol, providerId,
    providerInstrumentKey, providerSymbol, tickSizePaise, lotSize,
  };
  if (instrumentType === "EQUITY") {
    normalized.isin = requiredText(input.isin, "Equity ISIN", 12).toUpperCase();
    if (!ISIN_RE.test(normalized.isin)) fail("Equity ISIN format is invalid.");
  } else {
    normalized.underlyingInstrumentId = requiredText(input.underlyingInstrumentId, "Derivative underlying instrument identity", 180);
    normalized.expiryDate = validDate(input.expiryDate, "Derivative expiry");
    if (instrumentType === "OPTION") {
      normalized.optionType = input.optionType;
      normalized.strikePricePaise = input.strikePricePaise;
    }
  }
  normalized.instrumentId = canonicalInstrumentId(normalized);
  return Object.freeze(normalized);
}
function buildInstrumentMaster({ providerId, exchange, generatedAtMs, sourceDate, sourceReference, sourceSha256, records, nowMs = Date.now(), maxAgeMs = 7 * 86400000 } = {}) {
  if (!PROVIDER_RE.test(providerId || "") || !["NSE", "BSE"].includes(exchange)) fail("Master provider or exchange is invalid.");
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(generatedAtMs) ||
      generatedAtMs <= 0 || generatedAtMs > nowMs || nowMs - generatedAtMs > maxAgeMs) fail("Instrument master generation time is future-dated or stale.");
  validDate(sourceDate, "Master source date");
  requiredText(sourceReference, "Master source reference", 500);
  if (typeof sourceSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(sourceSha256)) fail("Master source SHA-256 is invalid.");
  if (!Array.isArray(records) || records.length === 0 || records.length > 200000) fail("Instrument master record count is outside safe bounds.");
  const instruments = [];
  const providerKeys = new Map();
  const canonicalIds = new Set();
  for (const raw of records) {
    const item = normalizeInstrumentRecord(raw, { providerId, exchange });
    const key = exchange + ":" + item.providerId + ":" + item.providerInstrumentKey;
    const prior = providerKeys.get(key);
    if (prior && prior !== item.instrumentId) fail("Provider instrument key maps to conflicting canonical instruments.");
    if (canonicalIds.has(item.instrumentId)) fail("Duplicate canonical instrument identity in provider master.");
    providerKeys.set(key, item.instrumentId);
    canonicalIds.add(item.instrumentId);
    instruments.push(item);
  }
  instruments.sort((a, b) => a.instrumentId.localeCompare(b.instrumentId));
  return Object.freeze({
    providerId, exchange, generatedAtMs, sourceDate, sourceReference,
    sourceSha256: sourceSha256.toLowerCase(),
    instrumentCount: instruments.length,
    instruments: Object.freeze(instruments),
  });
}
function buildProviderSymbolMap(masters) {
  if (!Array.isArray(masters) || masters.length === 0) fail("At least one validated provider master is required.");
  const mappings = new Map();
  for (const master of masters) {
    if (!master || !Array.isArray(master.instruments)) fail("Provider master is not validated.");
    for (const item of master.instruments) {
      const key = [item.providerId, item.exchange, item.providerInstrumentKey].join("|");
      const mapping = Object.freeze({
        providerId: item.providerId,
        exchange: item.exchange,
        providerInstrumentKey: item.providerInstrumentKey,
        providerSymbol: item.providerSymbol,
        instrumentId: item.instrumentId,
        sourceSha256: master.sourceSha256,
        sourceDate: master.sourceDate,
      });
      const prior = mappings.get(key);
      if (prior && prior.instrumentId !== mapping.instrumentId) fail("Provider symbol mapping collision detected.");
      if (prior) fail("Duplicate provider mapping key appears in the supplied masters.");
      mappings.set(key, mapping);
    }
  }
  return Object.freeze([...mappings.values()].sort((a, b) =>
    (a.providerId + a.exchange + a.providerInstrumentKey).localeCompare(b.providerId + b.exchange + b.providerInstrumentKey)));
}
module.exports = { normalizeInstrumentRecord, canonicalInstrumentId, buildInstrumentMaster, buildProviderSymbolMap };
