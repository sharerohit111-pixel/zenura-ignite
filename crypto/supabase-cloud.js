import { supabase } from "./supabase-client.js";

const meta = document.querySelector('meta[name="zenura-crypto-api-url"]');
const apiBase = (meta?.content || "").trim().replace(/\/+$/, "");
const supportedSymbols = new Set(["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","AVAXUSDT","PAXGUSDT","XAUTUSDT"]);
let activeUserId = null;
let loadGeneration = 0;
let pendingOrder = null;
let pendingLimitOrder = null;
let pendingResetRequestId = null;

async function accessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error("Your secure session could not be restored. Sign in again.");
  const token = data?.session?.access_token;
  if (!token) throw new Error("Sign in to use cloud paper trading.");
  return token;
}

async function api(path, options = {}, tokenOverride = null) {
  if (!apiBase) throw new Error("Secure cloud trading is not deployed yet. No order was placed.");
  const token = tokenOverride || await accessToken();
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
  const generation = ++loadGeneration;
  const token = await accessToken();
  const sessionBefore = await supabase.auth.getSession();
  const userId = sessionBefore?.data?.session?.user?.id || null;
  if (!userId) return;
  await api("/crypto/account", {}, token);
  const [portfolio, riskPlans] = await Promise.all([api("/crypto/portfolio", {}, token), api("/crypto/risk-plans", {}, token)]);
  const sessionAfter = await supabase.auth.getSession();
  if (generation !== loadGeneration || sessionAfter?.data?.session?.user?.id !== userId) return;
  publishPortfolio(portfolio);
  window.dispatchEvent(new CustomEvent("zenura-cloud-risk-plans", { detail: riskPlans.plans || [] }));
}

async function placeOrder({ symbol, side, quantity }) {
  if (!supportedSymbols.has(symbol) || !["BUY", "SELL"].includes(side)) throw new Error("Select a supported crypto spot market and order side.");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Enter a valid crypto quantity.");
  const quantityText = quantity.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  if (!pendingOrder || pendingOrder.symbol !== symbol || pendingOrder.side !== side || pendingOrder.quantity !== quantityText) {
    pendingOrder = { symbol, side, quantity: quantityText, key: crypto.randomUUID() };
  }
  const result = await api("/crypto/orders", {
    method: "POST",
    body: { symbol, side, quantity: quantityText, idempotency_key: pendingOrder.key }
  });
  if (result.status !== "FILLED" || result.simulationOnly !== true) throw new Error("The cloud did not confirm a completed paper order.");
  await load();
  pendingOrder = null;
  return result;
}

async function placeLimitOrder({ symbol, side, quantity, limitPrice }) {
  if (!supportedSymbols.has(symbol) || !["BUY", "SELL"].includes(side)) throw new Error("Select a supported crypto spot market and order side.");
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(limitPrice) || limitPrice <= 0) throw new Error("Enter a valid LIMIT quantity and price.");
  const quantityText = quantity.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  const limitPriceText = limitPrice.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  if (!pendingLimitOrder || pendingLimitOrder.symbol !== symbol || pendingLimitOrder.side !== side
      || pendingLimitOrder.quantity !== quantityText || pendingLimitOrder.limitPrice !== limitPriceText) {
    pendingLimitOrder = { symbol, side, quantity: quantityText, limitPrice: limitPriceText, key: crypto.randomUUID() };
  }
  const result = await api("/crypto/limit-orders", {
    method: "POST",
    body: { symbol, side, quantity: quantityText, limit_price: limitPriceText, idempotency_key: pendingLimitOrder.key }
  });
  if (!["PENDING", "FILLED"].includes(result.status) || result.simulationOnly !== true) throw new Error("The cloud did not confirm the LIMIT order.");
  await load();
  pendingLimitOrder = null;
  return result;
}

async function saveRiskPlan({ symbol, quantity, stopLossPrice = null, takeProfitPrice = null }) {
  if (!supportedSymbols.has(symbol) || !Number.isFinite(quantity) || quantity <= 0) throw new Error("Select a valid Crypto position and exit quantity.");
  if ((stopLossPrice == null || stopLossPrice === 0) && (takeProfitPrice == null || takeProfitPrice === 0)) throw new Error("Set a stop-loss or target price.");
  if (stopLossPrice != null && stopLossPrice !== 0 && (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0)) throw new Error("Invalid stop-loss price.");
  if (takeProfitPrice != null && takeProfitPrice !== 0 && (!Number.isFinite(takeProfitPrice) || takeProfitPrice <= 0)) throw new Error("Invalid target price.");
  if (stopLossPrice > 0 && takeProfitPrice > 0 && stopLossPrice >= takeProfitPrice) throw new Error("Stop loss must be below target.");
  const result = await api("/crypto/risk-plans", { method: "POST", body: {
    symbol, quantity: quantity.toFixed(12).replace(/0+$/, "").replace(/\.$/, ""),
    stop_loss_price: stopLossPrice > 0 ? stopLossPrice.toFixed(8).replace(/0+$/, "").replace(/\.$/, "") : null,
    take_profit_price: takeProfitPrice > 0 ? takeProfitPrice.toFixed(8).replace(/0+$/, "").replace(/\.$/, "") : null,
    idempotency_key: crypto.randomUUID()
  }});
  await load();
  return result;
}

async function cancelRiskPlan(planId) {
  if (typeof planId !== "string" || !/^[0-9a-f-]{36}$/i.test(planId)) throw new Error("Invalid Crypto risk plan ID.");
  const result = await api("/crypto/risk-plans/" + planId + "/cancel", { method: "POST", body: {} });
  if (result.cancelled !== true) throw new Error("The cloud did not confirm SL/Target cancellation.");
  await load();
  return result;
}

async function resetAccount() {
  if (!pendingResetRequestId) pendingResetRequestId = crypto.randomUUID();
  const result = await api("/crypto/account/reset", {
    method: "POST",
    body: { request_id: pendingResetRequestId }
  });
  if (result.historyPreserved !== true || result.simulationOnly !== true) {
    throw new Error("The cloud did not confirm a safe simulation-only account reset.");
  }
  pendingOrder = null;
  pendingLimitOrder = null;
  await load();
  pendingResetRequestId = null;
  return result;
}

async function cancelLimitOrder(orderId) {
  if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) throw new Error("Invalid cloud LIMIT order ID.");
  const result = await api("/crypto/limit-orders/" + orderId + "/cancel", { method: "POST", body: {} });
  if (result.cancelled !== true) throw new Error("The cloud did not confirm LIMIT cancellation.");
  await load();
  return result;
}

window.ZENURA_CRYPTO_TRADING = Object.freeze({ load, placeOrder, placeLimitOrder, cancelLimitOrder, saveRiskPlan, cancelRiskPlan, resetAccount, isConfigured: () => Boolean(apiBase) });

supabase.auth.onAuthStateChange((_event, session) => {
  const nextUserId = session?.user?.id || null;
  if (nextUserId === activeUserId) return;
  activeUserId = nextUserId;
  loadGeneration++;
  // Clear the previous account's private SL/Target list immediately on sign-out or account switch.
  // The next authenticated load will publish only the newly verified user's plans.
  window.dispatchEvent(new CustomEvent("zenura-cloud-risk-plans", { detail: [] }));
  if (nextUserId) load().catch(error => console.warn("Crypto cloud portfolio unavailable:", error.message));
});
supabase.auth.getSession().then(({ data, error }) => {
  if (error) return;
  activeUserId = data?.session?.user?.id || null;
  if (activeUserId) load().catch(problem => console.warn("Crypto cloud portfolio unavailable:", problem.message));
});
