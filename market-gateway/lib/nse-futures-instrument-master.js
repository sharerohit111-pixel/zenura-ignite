"use strict";

const { normalizeExpiryDate, normalizeTickSizePaise } = require("./derivative-contract");

function fail(message) {
  throw Object.assign(new Error(message), { status: 422 });
}

function expiryCutoffMs(expiry) {
  const [year, month, day] = expiry.split("-").map(Number);
  return Date.UTC(year, month - 1, day, 10, 0, 0, 0); // 15:30 Asia/Kolkata
}

function normalizeUnderlying(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized && normalized.length <= 80 ? normalized : null;
}

/**
 * Normalize an Upstox BOD instrument-master payload into the NSE Futures
 * contract shape used by the paper-trading domain. This is deliberately pure:
 * it performs no network access, cache writes, order execution or accounting.
 */
function normalizeUpstoxNseFuturesMaster(rows, { nowMs = Date.now() } = {}) {
  if (!Array.isArray(rows) || rows.length === 0
      || !Number.isSafeInteger(nowMs) || nowMs < 1) {
    fail("A non-empty Upstox instrument master and valid timestamp are required.");
  }

  const contracts = [];
  const seen = new Set();
  let expiredCount = 0;
  let ignoredCount = 0;

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      ignoredCount++;
      continue;
    }
    if (row.exchange !== "NSE" || row.segment !== "NSE_FO" || row.instrument_type !== "FUT") {
      ignoredCount++;
      continue;
    }

    const instrumentKey = typeof row.instrument_key === "string" ? row.instrument_key.trim() : "";
    const tradingSymbol = typeof row.trading_symbol === "string" ? row.trading_symbol.trim() : "";
    const underlyingSymbol = normalizeUnderlying(row.underlying_symbol);
    const expiry = normalizeExpiryDate(row.expiry);
    const lotSize = row.lot_size;
    const tickSizePaise = normalizeTickSizePaise(row.tick_size);

    if (!instrumentKey.startsWith("NSE_FO|") || !tradingSymbol || !underlyingSymbol
        || !expiry || !Number.isSafeInteger(lotSize) || lotSize < 1 || lotSize > 1000000
        || tickSizePaise === null) {
      fail("The Upstox NSE Futures instrument master contains an invalid contract row.");
    }
    if (seen.has(instrumentKey)) {
      fail("The Upstox NSE Futures instrument master contains a duplicate instrument key.");
    }
    seen.add(instrumentKey);

    if (nowMs >= expiryCutoffMs(expiry)) {
      expiredCount++;
      continue;
    }

    contracts.push(Object.freeze({
      provider: "UPSTOX",
      exchange: "NSE",
      segment: "NSE_FO",
      instrumentType: "FUT",
      instrumentKey,
      tradingSymbol,
      underlyingSymbol,
      expiry,
      lotSize,
      tickSizePaise
    }));
  }

  contracts.sort((a, b) =>
    a.underlyingSymbol.localeCompare(b.underlyingSymbol)
    || a.expiry.localeCompare(b.expiry)
    || a.tradingSymbol.localeCompare(b.tradingSymbol)
  );

  return Object.freeze({
    provider: "UPSTOX",
    asOfMs: nowMs,
    contracts: Object.freeze(contracts),
    contractCount: contracts.length,
    expiredCount,
    ignoredCount
  });
}

/**
 * Select a listed NSE Futures contract by its explicit underlying symbol.
 * The default is the nearest unexpired listed expiry; callers can request an
 * exact expiry. No monthly/weekly inference or symbol-string guessing occurs.
 */
function selectNseFuturesContract(master, {
  underlyingSymbol,
  expiry = null
} = {}) {
  const underlying = normalizeUnderlying(underlyingSymbol);
  if (!master || master.provider !== "UPSTOX" || !Array.isArray(master.contracts) || !underlying) {
    fail("A normalized Futures master and explicit underlying symbol are required.");
  }
  const normalizedExpiry = expiry === null ? null : normalizeExpiryDate(expiry);
  if (expiry !== null && !normalizedExpiry) fail("A valid explicit contract expiry is required.");

  const matches = master.contracts.filter(contract =>
    contract.exchange === "NSE"
    && contract.segment === "NSE_FO"
    && contract.instrumentType === "FUT"
    && contract.underlyingSymbol === underlying
    && (normalizedExpiry === null || contract.expiry === normalizedExpiry)
  );
  if (!matches.length) fail("No eligible NSE Futures contract matches the requested underlying and expiry.");

  return matches[0];
}

module.exports = { normalizeUpstoxNseFuturesMaster, selectNseFuturesContract };
