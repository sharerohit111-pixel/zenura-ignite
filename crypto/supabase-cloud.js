import { supabase } from "../markets/stocks/supabase-client.js";

const meta = document.querySelector('meta[name="zenura-crypto-api-url"]');
const apiBase = (meta?.content || "").trim().replace(/\/+$/, "");
const supportedSymbols = new Set(["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","AVAXUSDT","PAXGUSDT","XAUTUSDT"]);
let activeUserId = null;
let loading = false;

async function accessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error("Your secure session could not be restored. Sign in again.");
  const token = data?.session?.access_token;
  if (!token) throw new Error("Sign in to use cloud paper trading.");
  return token;
}

async function api(path, options = {}) {
  if (!apiBase) throw new Error("Secure cloud trading is not deployed yet. No order was placed.");
  const token = await accessToken();
  const response = await fetch(apiBase + path, {
    method: options.method || "GET",
    cache: "no-store",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(payload?.error || "Cloud paper trading request failed (" + response.status + ").");
  if (payload?.simulationOnly !== true) throw new Error("The server did not confirm simulation-only execution.");
  return payload;
}

function publishPortfolio(payload) {
  const account = payload?.account;
  if (!account || account.currency !== "INR" || !Array.isArray(payload.positions) || !Array.isArray(payload.orders)) {
    throw new Error("Cloud portfolio response is incomplete or invalid.");
  }
  window.dispatchEvent(new CustomEvent("zenura-cloud-portfolio", { detail: payload }));
}

async function load() {
  if (loading) return;
  loading = true;
  try {
    await api("/crypto/account");
    const portfolio = await api("/crypto/portfolio");
    publishPortfolio(portfolio);
  } finally {
    loading = false;
  }
}

async function placeOrder({ symbol, side, quantity }) {
  if (!supportedSymbols.has(symbol) || !["BUY", "SELL"].includes(side)) throw new Error("Select a supported crypto spot market and order side.");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Enter a valid crypto quantity.");
  const result = await api("/crypto/orders", {
    method: "POST",
    body: { symbol, side, quantity: quantity.toFixed(12).replace(/0+$/, "").replace(/\.$/, ""), idempotency_key: crypto.randomUUID() }
  });
  if (result.status !== "FILLED" || result.simulationOnly !== true) throw new Error("The cloud did not confirm a completed paper order.");
  await load();
  return result;
}

window.ZENURA_CRYPTO_TRADING = Object.freeze({ load, placeOrder, isConfigured: () => Boolean(apiBase) });

supabase.auth.onAuthStateChange((_event, session) => {
  const nextUserId = session?.user?.id || null;
  if (nextUserId === activeUserId) return;
  activeUserId = nextUserId;
  if (nextUserId) load().catch(error => console.warn("Crypto cloud portfolio unavailable:", error.message));
});
supabase.auth.getSession().then(({ data, error }) => {
  if (error) return;
  activeUserId = data?.session?.user?.id || null;
  if (activeUserId) load().catch(problem => console.warn("Crypto cloud portfolio unavailable:", problem.message));
});
