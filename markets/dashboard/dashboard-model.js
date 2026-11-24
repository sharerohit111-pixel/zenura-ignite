export const NAV_ITEMS = Object.freeze([
  ["home","Home","⌂"],["market","Market","▥"],["watchlist","Watchlist","☆"],
  ["orders","Orders","⇄"],["portfolio","Portfolio","◫"],["positions","Positions","⌁"],
  ["holdings","Holdings","▤"],["profile","Profile","◎"],["settings","Settings","⚙"]
]);
export function findInstrument(data, symbol) {
  return (data?.instruments || []).find(item => item.symbol === symbol) || null;
}
export function getWatchlist(data) {
  return (data?.watchlist || []).map(symbol => findInstrument(data, symbol)).filter(Boolean);
}
export function formatINR(value, compact = false) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 2,
    notation: compact ? "compact" : "standard"
  }).format(amount);
}
export function formatSigned(value, suffix = "") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return (amount > 0 ? "+" : "") + amount.toLocaleString("en-IN", {maximumFractionDigits: 2}) + suffix;
}
export function validateDashboardData(data) {
  if (!data || data.meta?.provider !== "DUMMY_JSON" || data.meta?.mode !== "DEMO" ||
      data.meta?.schemaVersion !== "1.0.0" || data.meta?.simulated !== true ||
      data.meta?.source !== "SYNTHETIC_FIXTURE") {
    throw new TypeError("Dashboard requires an explicitly labelled v1.0.0 synthetic DUMMY_JSON fixture.");
  }
  for (const key of ["account","indices","instruments","watchlist","orders","holdings","positions","performance"]) {
    if (!(key in data)) throw new TypeError("Missing dashboard dataset: " + key);
  }
  const symbols = new Set((data.instruments || []).map(item => item.symbol));
  for (const item of data.instruments || []) {
    if (typeof item.symbol !== "string" || !/^MOCK[A-Z0-9-]*$/.test(item.symbol) ||
        typeof item.instrumentKey !== "string" || !item.instrumentKey.startsWith("MOCK|") ||
        !["NSE","BSE"].includes(item.exchange)) {
      throw new TypeError("Dashboard instruments must use synthetic MOCK identities.");
    }
  }
  for (const item of data.indices || []) {
    if (typeof item.symbol !== "string" || !/^MOCK[A-Z0-9-]*$/.test(item.symbol) ||
        typeof item.instrumentKey !== "string" || !item.instrumentKey.startsWith("MOCK|")) {
      throw new TypeError("Dashboard indices must use synthetic MOCK identities.");
    }
  }
  for (const key of ["watchlist","orders","holdings","positions"]) {
    for (const item of data[key] || []) {
      const symbol = typeof item === "string" ? item : item.symbol;
      if (!symbols.has(symbol)) throw new TypeError("Unknown synthetic dashboard instrument: " + symbol);
    }
  }
  if (data.account?.ledgerReconciled !== false) {
    throw new TypeError("Dashboard demo account must preserve the unreconciled ledger state.");
  }
  return data;
}
