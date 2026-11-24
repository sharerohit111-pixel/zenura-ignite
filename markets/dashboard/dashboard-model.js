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
  if (!data || data.meta?.provider !== "DUMMY_JSON" || data.meta?.mode !== "DEMO") {
    throw new TypeError("Dashboard requires explicitly labelled DUMMY_JSON demo data.");
  }
  for (const key of ["account","indices","instruments","watchlist","orders","holdings","positions","performance"]) {
    if (!(key in data)) throw new TypeError("Missing dashboard dataset: " + key);
  }
  return data;
}
