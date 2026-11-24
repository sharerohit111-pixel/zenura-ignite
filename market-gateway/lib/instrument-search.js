"use strict";

function rankInstrumentSearchResults(items, query, limit = 100) {
  if (!Array.isArray(items)) throw new TypeError("Instrument results must be an array.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Instrument result limit must be an integer from 1 to 100.");
  const q = String(query || "").trim().toLowerCase().slice(0, 60);
  if (!q) return items.slice(0, limit);

  function score(item) {
    const symbol = String(item?.trading_symbol || "").trim().toLowerCase();
    const name = String(item?.name || "").trim().toLowerCase();
    const underlying = String(item?.underlying_symbol || "").trim().toLowerCase();
    if (symbol === q) return 0;
    if (name === q) return 1;
    if (symbol.startsWith(q)) return 2;
    if (name.startsWith(q)) return 3;
    if (underlying === q || underlying.startsWith(q)) return 4;
    if (symbol.includes(q)) return 5;
    if (name.includes(q)) return 6;
    if (underlying.includes(q)) return 7;
    return Number.POSITIVE_INFINITY;
  }

  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .filter(entry => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score ||
      String(a.item?.trading_symbol || "").localeCompare(String(b.item?.trading_symbol || ""), "en") ||
      String(a.item?.instrument_key || "").localeCompare(String(b.item?.instrument_key || ""), "en") ||
      a.index - b.index)
    .slice(0, limit)
    .map(entry => entry.item);
}

module.exports = { rankInstrumentSearchResults };
