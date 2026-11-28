/* Native Supabase Auth connector for the ZENURA IGNITE Indian Market workspace. */
import { supabase } from "./supabase-client.js";

// Shared only with same-origin chart persistence; authenticated requests still use the user session and RLS.
window.ZENURA_SUPABASE = supabase;

const button = document.getElementById("upstox-connect");
const disconnectButton = document.getElementById("upstox-disconnect");
const card = document.getElementById("connection");
const heading = document.getElementById("connection-title");
const detail = document.getElementById("connection-sub");
const gateway = (document.querySelector('meta[name="market-gateway-url"]')?.content || "").trim().replace(/\/+$/, "");

function setState(title, message, connected = false, showDisconnect = connected) {
  if (heading) heading.textContent = title;
  if (detail) detail.textContent = message;
  if (card) card.classList.toggle("connected", connected);
  if (button) button.textContent = connected ? "RECONNECT UPSTOX" : "CONNECT UPSTOX";
  if (disconnectButton) disconnectButton.hidden = !showDisconnect;
}
function explainError(error, payload) {
  const code = error?.code || payload?.code || "";
  if (code === "session_not_found" || code === "invalid_jwt") return "Your sign-in session expired. Sign in again.";
  if (code === "email_not_confirmed") return "Verify your email address before connecting Upstox.";
  if (!gateway) return "Market gateway URL is not configured. Supabase sign-in is available; market connection awaits the new gateway.";
  return payload?.error || error?.message || "The secure market service is unavailable. Please retry.";
}
async function sessionSnapshot() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session || null;
}
let authStateSequence = 0;
async function api(path, options = {}) {
  const requestAuthSequence = authStateSequence;
  const session = await sessionSnapshot();
  if (requestAuthSequence !== authStateSequence) {
    throw new Error("Session changed before the request started. Sign in again.");
  }
  if (!session?.access_token || !session?.user?.id) throw new Error("Sign in to continue.");
  const requestUserId = session.user.id;
  if (!gateway) throw new Error("Market gateway URL is not configured yet.");
  const response = await fetch(gateway + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + session.access_token,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({}));
  const latestSession = await sessionSnapshot().catch(() => null);
  if (requestAuthSequence !== authStateSequence || latestSession?.user?.id !== requestUserId) {
    throw new Error("Account session changed while the request was processing. Sign in again.");
  }
  if (!response.ok) {
    const error = new Error(payload.error || "Market service request failed (" + response.status + ").");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}
let currentSession = null;
async function refreshStatus(sequence = authStateSequence) {
  const session = await sessionSnapshot().catch(() => null);
  if (sequence !== authStateSequence) return;
  if (!session?.user) {
    setState("SIGN IN REQUIRED", "Create an account or sign in using Supabase below. No Firebase account is used.");
    return;
  }
  if (!gateway) {
    setState("SUPABASE SIGNED IN", "Signed in securely. Configure the Supabase-native market gateway to connect Upstox.");
    return;
  }
  try {
    const data = await api("/upstox/connection");
    if (sequence !== authStateSequence) return;
    if (data.connected) {
      const expiry = Number.isFinite(data.expiresAt)
        ? new Date(data.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
        : "provider expiry";
      setState("UPSTOX AUTHORIZED", (data.feedReady ? "Market feed gateway is ready. " : "Account authorized. ")
        + "Access token expires at " + expiry + ".", true);
    } else {
      setState("UPSTOX NOT CONNECTED", "Authorize Upstox to enable verified Indian market data.");
    }
  } catch (error) {
    if (sequence === authStateSequence) setState("MARKET BACKEND NOT READY", explainError(error, error.payload));
  }
}
disconnectButton?.addEventListener("click", async () => {
  disconnectButton.disabled = true;
  try {
    setState("DISCONNECTING UPSTOX", "Ending this app's market-data connection…", false, true);
    await api("/upstox/connection", { method: "DELETE" });
    await refreshStatus(authStateSequence);
  } catch (error) {
    setState("DISCONNECT FAILED", explainError(error, error.payload), false, true);
  } finally {
    disconnectButton.disabled = false;
  }
});
button?.addEventListener("click", async () => {
  button.disabled = true;
  try {
    const session = await sessionSnapshot();
    if (!session?.user) {
      setState("SIGN IN REQUIRED", "Create an account or sign in with Supabase below.");
      document.getElementById("market-email")?.focus();
      return;
    }
    setState("STARTING UPSTOX", "Preparing secure authorization…");
    const result = await api("/upstox/oauth/start", { method: "POST", body: "{}" });
    const url = result.authorizationUrl;
    if (typeof url !== "string" || !url.startsWith("https://api.upstox.com/")) {
      throw new Error("The server did not return a valid Upstox authorization URL.");
    }
    window.location.assign(url);
  } catch (error) {
    setState("CONNECTION NOT COMPLETED", explainError(error, error.payload), false, false);
  } finally {
    button.disabled = false;
  }
});
window.ZENURA_MARKET_CONNECTOR = Object.freeze({
  isAuthenticated: () => !!currentSession?.user,
  getUserId: () => currentSession?.user?.id || null,
  getIdToken: async () => {
    const session = await sessionSnapshot();
    if (!session?.access_token) throw new Error("Sign in to connect the live market feed.");
    return session.access_token;
  },
  getAccessToken: async () => {
    const session = await sessionSnapshot();
    if (!session?.access_token) throw new Error("Sign in to access your private Paper Trading account.");
    return session.access_token;
  }
});
supabase.auth.onAuthStateChange((authEvent, session) => {
  const previousUserId = currentSession?.user?.id || null;
  currentSession = session || null;
  const userId = currentSession?.user?.id || null;
  const sequence = ++authStateSequence;
  window.dispatchEvent(new CustomEvent("zenura-market-auth-ready", {
    detail: {
      signedIn: !!userId,
      userId,
      previousUserId,
      identityChanged: previousUserId !== userId,
      authEvent,
      sequence
    }
  }));
  // Defer network work until after the auth callback returns to avoid auth-lock deadlocks.
  queueMicrotask(() => refreshStatus(sequence));
});
if (new URLSearchParams(location.search).get("upstox") === "connected") {
  history.replaceState({}, "", location.pathname);
  queueMicrotask(() => refreshStatus());
}
