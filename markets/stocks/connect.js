/* Indian Market account connection — uses the root ZENURA Firebase project,
 * intentionally separate from the legacy Crypto Firebase auth project. */
import { auth } from "../../firebase-client.js";
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

const REGION = "asia-south1";
const functions = getFunctions(auth.app, REGION);
const startAuthorization = httpsCallable(functions, "startUpstoxAuthorization");
const getConnectionStatus = httpsCallable(functions, "getIndianMarketConnectionStatus");
const disconnectAccount = httpsCallable(functions, "disconnectUpstoxAccount");
const button = document.getElementById("upstox-connect");
const disconnectButton = document.getElementById("upstox-disconnect");
const card = document.getElementById("connection");
const heading = document.getElementById("connection-title");
const detail = document.getElementById("connection-sub");

function setState(title, message, connected = false, showDisconnect = connected) {
  heading.textContent = title;
  detail.textContent = message;
  card.classList.toggle("connected", connected);
  button.textContent = connected ? "RECONNECT UPSTOX" : (auth.currentUser ? "CONNECT UPSTOX" : "SIGN IN / CONNECT");
  disconnectButton.hidden = !showDisconnect;
}
let authStateSequence = 0;

function explainError(error) {
  const code = error?.code || "";
  if (code.includes("unauthenticated")) return "Sign-in required. Please sign in and retry.";
  if (code.includes("permission-denied")) return "This account is not allowed to start authorization.";
  if (code.includes("not-found") || code.includes("unavailable")) return "Backend functions are not deployed to the configured Firebase project yet.";
  if (code.includes("unauthorized-domain")) return "Add this website domain in Firebase Authentication → Settings → Authorized domains.";
  return error?.message || "Could not connect. Please retry.";
}
async function refreshStatus(sequence = authStateSequence) {
  const userAtStart = auth.currentUser;
  if (!userAtStart) {
    setState("SIGN IN REQUIRED", "Sign in with Google to securely connect your Upstox account.");
    return;
  }
  try {
    const result = await getConnectionStatus();
    if (sequence !== authStateSequence || auth.currentUser?.uid !== userAtStart.uid) return;
    const data = result.data || {};
    if (data.connected) {
      const expiry = Number.isFinite(data.expiresAt)
        ? new Date(data.expiresAt).toLocaleString("en-IN", {timeZone:"Asia/Kolkata", dateStyle:"medium", timeStyle:"short"})
        : "03:30 AM IST daily cutoff";
      setState("UPSTOX AUTHORIZED", (data.feedReady
        ? "Market feed gateway is ready."
        : "Account authorized. Select an instrument to check live feed availability.")
        + " Access token expires at " + expiry + "; reconnect after expiry.", true);
    } else if (data.status === "token_expired") {
      setState("UPSTOX TOKEN EXPIRED", "Upstox standard access tokens expire at 03:30 AM IST. Reconnect your account to continue, or disconnect the saved token.", false, true);
    } else {
      setState("UPSTOX NOT CONNECTED", "Authorize Upstox to link your trading account.");
    }
  } catch (error) {
    if (sequence === authStateSequence && auth.currentUser?.uid === userAtStart.uid) {
      setState("BACKEND NOT READY", explainError(error));
    }
  }
}
disconnectButton.addEventListener("click", async () => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  disconnectButton.disabled = true;
  try {
    setState("DISCONNECTING UPSTOX", "Removing the locally saved token and ending this app's live feed…");
    await disconnectAccount();
    if (auth.currentUser?.uid !== uid) return;
    const sequence = authStateSequence;
    await refreshStatus(sequence);
    if (sequence === authStateSequence && auth.currentUser?.uid === uid) {
      setState("UPSTOX DISCONNECTED", "Saved token removed and this app's feed will close on its next lease check. This does not revoke app access at Upstox; remove that permission separately in your Upstox account.", false, false);
    }
  } catch (error) {
    if (auth.currentUser?.uid === uid) setState("DISCONNECT FAILED", explainError(error));
  } finally {
    disconnectButton.disabled = false;
  }
});
button.addEventListener("click", async () => {
  button.disabled = true;
  let uid = auth.currentUser?.uid || null;
  try {
    if (!auth.currentUser) {
      setState("SIGNING IN", "Complete Google sign-in in the popup.");
      await signInWithPopup(auth, new GoogleAuthProvider());
      uid = auth.currentUser?.uid || null;
    }
    if (!uid || auth.currentUser?.uid !== uid) return;
    const currentUser = auth.currentUser;
    const usesPasswordProvider = currentUser.providerData?.some(provider => provider.providerId === "password");
    if (usesPasswordProvider && !currentUser.emailVerified) {
      setState("EMAIL VERIFICATION REQUIRED", "Verify your email address using the link sent by Firebase, then sign in again before connecting Upstox.");
      return;
    }
    const sequence = authStateSequence;
    setState("STARTING UPSTOX", "Preparing secure authorization…");
    const result = await startAuthorization();
    if (sequence !== authStateSequence || auth.currentUser?.uid !== uid) return;
    const url = result.data?.authorizationUrl;
    if (!url || !url.startsWith("https://api.upstox.com/")) {
      throw new Error("The server did not return a valid Upstox authorization URL.");
    }
    window.location.assign(url);
  } catch (error) {
    if (!uid || auth.currentUser?.uid === uid) setState("CONNECTION NOT COMPLETED", explainError(error));
  } finally {
    button.disabled = false;
  }
});
window.ZENURA_MARKET_CONNECTOR = {
  isAuthenticated: () => !!auth.currentUser,
  getUserId: () => auth.currentUser?.uid || null,
  getIdToken: async () => {
    if (!auth.currentUser) throw new Error("Sign in to connect the live market feed.");
    return auth.currentUser.getIdToken();
  }
};
onAuthStateChanged(auth, async user => {
  const sequence = ++authStateSequence;
  // Clear the previous account's private UI immediately on every auth transition.
  // Do not wait for a network-backed connection-status lookup before notifying the market page.
  window.dispatchEvent(new CustomEvent("zenura-market-auth-ready", { detail: { signedIn: !!user } }));
  await refreshStatus(sequence);
});
if (new URLSearchParams(location.search).get("upstox") === "connected") {
  history.replaceState({}, "", location.pathname);
}
