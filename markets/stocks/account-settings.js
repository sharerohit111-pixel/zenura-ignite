/* Isolated account controls for S-TRADE. Auth remains owned by Supabase Auth. */
import { supabase } from "./supabase-client.js";

const host = document.getElementById("connection");
if (host && !document.getElementById("s-trade-account")) {
  const root = document.createElement("section");
  root.id = "s-trade-account";
  root.className = "s-trade-account";
  root.innerHTML = `
    <h3>USER ACCOUNT & WALLET</h3>
    <p id="s-trade-account-status" class="account-status" role="status">Sign in to view your account.</p>
    <button type="button" id="s-trade-dev-mock-login" hidden>DEVELOPMENT MOCK LOGIN · LOCAL ONLY</button>
    <div id="s-trade-phone-auth">
      <label>Mobile number (with country code)
        <input id="s-trade-phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="+91XXXXXXXXXX">
      </label>
      <label>SMS verification code
        <input id="s-trade-otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="Enter OTP">
      </label>
      <div class="account-actions">
        <button type="button" id="s-trade-send-otp">SEND OTP</button>
        <button type="button" class="primary" id="s-trade-verify-otp">VERIFY & SIGN IN</button>
      </div>
      <p>SMS login requires the Supabase Phone provider and an SMS delivery provider to be enabled for this project.</p>
    </div>
    <div id="s-trade-account-private" hidden>
      <label>Display name
        <input id="s-trade-display-name" type="text" maxlength="80" autocomplete="name" placeholder="Your name">
      </label>
      <div class="account-security">
        <label>Change account email
          <input id="s-trade-new-email" type="email" maxlength="254" autocomplete="email" placeholder="New email address">
        </label>
        <button type="button" id="s-trade-update-email">UPDATE EMAIL</button>
        <label>New password
          <input id="s-trade-new-password" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="At least 8 characters">
        </label>
        <button type="button" id="s-trade-change-password">CHANGE PASSWORD</button>
      </div>
      <div class="account-actions">
        <button type="button" class="primary" id="s-trade-save-profile">SAVE PROFILE</button>
        <button type="button" id="s-trade-refresh-session">REFRESH SESSION</button>
        <button type="button" id="s-trade-refresh-wallet">REFRESH WALLET</button>
        <button type="button" id="s-trade-sign-out">SIGN OUT</button>
      </div>
      <p id="s-trade-session-info"></p>
      <div class="wallet-grid" aria-label="Virtual wallet balances">
        <div class="wallet-cell"><small>VIRTUAL CAPITAL</small><b id="s-trade-wallet-start">—</b></div>
        <div class="wallet-cell"><small>WALLET CASH</small><b id="s-trade-wallet-cash">—</b></div>
        <div class="wallet-cell"><small>BLOCKED FUNDS</small><b id="s-trade-wallet-blocked">—</b></div>
        <div class="wallet-cell"><small>AVAILABLE FUNDS</small><b id="s-trade-wallet-available">—</b></div>
      </div>
      <p class="account-note">Simulation only. Wallet values are the current account snapshot; ledger reconciliation is not yet enabled in this branch.</p>
    </div>`;
  host.append(root);

  const $ = id => root.querySelector("#" + id);
  const status = $("s-trade-account-status");
  const privatePanel = $("s-trade-account-private");
  const phonePanel = $("s-trade-phone-auth");
  const mockButton = $("s-trade-dev-mock-login");
  const isLocalDevelopment = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  let devMockActive = false;
  if (isLocalDevelopment) mockButton.hidden = false;
  else mockButton.remove();
  const gateway = (document.querySelector('meta[name="market-gateway-url"]')?.content || "").trim().replace(/\/+$/, "");
  let currentUserId = null;
  let authSequence = 0;

  function money(paise) {
    const value = Number(paise);
    if (!Number.isSafeInteger(value) || value < 0) return "—";
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value / 100);
  }
  function setBusy(ids, busy) { for (const id of ids) $(id).disabled = busy; }
  function clearWallet() {
    for (const id of ["s-trade-wallet-start","s-trade-wallet-cash","s-trade-wallet-blocked","s-trade-wallet-available"]) $(id).textContent = "—";
  }
  async function loadProfile(userId) {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data.user || data.user.id !== userId) throw new Error("Account changed. Sign in again.");
    $("s-trade-display-name").value = data.user.user_metadata?.display_name || "";
    $("s-trade-session-info").textContent = "Signed in as " + (data.user.phone || data.user.email || "verified account");
  }
  async function loadWallet(userId) {
    if (!gateway) throw new Error("Market gateway is not configured.");
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token) throw new Error("Your session expired. Sign in again.");
    const response = await fetch(gateway + "/paper/account", {
      headers: { Authorization: "Bearer " + data.session.access_token, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Wallet could not be loaded.");
    if (currentUserId !== userId) return;
    $("s-trade-wallet-start").textContent = money(payload.startingCashPaise);
    $("s-trade-wallet-cash").textContent = money(payload.cashPaise);
    $("s-trade-wallet-blocked").textContent = money((payload.reservedCashPaise || 0) + (payload.reservedMarginPaise || 0));
    $("s-trade-wallet-available").textContent = money(payload.availableCashPaise);
  }
  async function syncAuth(session) {
    if (devMockActive) return;
    const sequence = ++authSequence;
    const user = session?.user || null;
    currentUserId = user?.id || null;
    clearWallet();
    if (!user) {
      privatePanel.hidden = true;
      phonePanel.hidden = false;
      status.textContent = "Sign in with email/password or request a mobile OTP.";
      return;
    }
    phonePanel.hidden = true;
    privatePanel.hidden = false;
    status.textContent = "Loading your private account…";
    try {
      await loadProfile(user.id);
      await loadWallet(user.id);
      if (sequence === authSequence && currentUserId === user.id) status.textContent = "Your private S-TRADE account is ready.";
    } catch (error) {
      if (sequence === authSequence && currentUserId === user.id) status.textContent = error.message || "Account could not be loaded.";
    }
  }

  mockButton.addEventListener("click", () => {
    if (!isLocalDevelopment) return;
    devMockActive = true;
    authSequence++;
    currentUserId = "development-mock-user";
    phonePanel.hidden = true;
    privatePanel.hidden = false;
    clearWallet();
    $("s-trade-display-name").value = "Development Demo";
    $("s-trade-session-info").textContent = "Local demo only · no authenticated Supabase session";
    $("s-trade-wallet-start").textContent = "₹10,00,000.00";
    $("s-trade-wallet-cash").textContent = "₹10,00,000.00";
    $("s-trade-wallet-blocked").textContent = "₹0.00";
    $("s-trade-wallet-available").textContent = "₹10,00,000.00";
    status.textContent = "DEVELOPMENT MOCK SESSION — local UI preview only. No API access, orders, database writes or real authentication.";
    mockButton.hidden = true;
  });

  $("s-trade-send-otp").addEventListener("click", async () => {
    const phone = $("s-trade-phone").value.trim();
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) { status.textContent = "Enter a valid international phone number, for example +91XXXXXXXXXX."; return; }
    setBusy(["s-trade-send-otp","s-trade-verify-otp"], true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } });
      if (error) throw error;
      status.textContent = "OTP sent. Check your SMS and verify the code.";
      $("s-trade-otp").focus();
    } catch (error) {
      status.textContent = error.message || "OTP could not be sent. Check Supabase Phone provider configuration.";
    } finally { setBusy(["s-trade-send-otp","s-trade-verify-otp"], false); }
  });
  $("s-trade-verify-otp").addEventListener("click", async () => {
    const phone = $("s-trade-phone").value.trim(), token = $("s-trade-otp").value.trim();
    if (!/^\+[1-9]\d{7,14}$/.test(phone) || !/^\d{4,8}$/.test(token)) { status.textContent = "Enter the same mobile number and the SMS OTP."; return; }
    setBusy(["s-trade-send-otp","s-trade-verify-otp"], true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
      if (error) throw error;
      await syncAuth(data.session);
    } catch (error) {
      status.textContent = error.message || "OTP verification failed.";
    } finally { setBusy(["s-trade-send-otp","s-trade-verify-otp"], false); }
  });
  $("s-trade-update-email").addEventListener("click", async () => {
    if (devMockActive) { status.textContent = "Email changes are disabled in the local mock preview."; return; }
    if (!currentUserId) return;
    const email = $("s-trade-new-email").value.trim();
    if (!email || !$("s-trade-new-email").checkValidity()) { status.textContent = "Enter a valid new email address."; return; }
    $("s-trade-update-email").disabled = true;
    try {
      const { data, error } = await supabase.auth.updateUser({ email });
      if (error) throw error;
      if (data.user?.id !== currentUserId) throw new Error("Account changed. Please sign in again.");
      $("s-trade-new-email").value = "";
      status.textContent = "Email change requested. Complete the confirmation steps sent by Supabase before the new address becomes active.";
    } catch (error) { status.textContent = error.message || "Email change could not be requested."; }
    finally { $("s-trade-update-email").disabled = false; }
  });
  $("s-trade-change-password").addEventListener("click", async () => {
    if (devMockActive) { status.textContent = "Password changes are disabled in the local mock preview."; return; }
    if (!currentUserId) return;
    const password = $("s-trade-new-password").value;
    if (password.length < 8 || password.length > 128) { status.textContent = "Choose a password between 8 and 128 characters."; return; }
    $("s-trade-change-password").disabled = true;
    try {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      if (data.user?.id !== currentUserId) throw new Error("Account changed. Please sign in again.");
      $("s-trade-new-password").value = "";
      status.textContent = "Password updated successfully.";
    } catch (error) { status.textContent = error.message || "Password could not be updated."; }
    finally { $("s-trade-change-password").disabled = false; }
  });

  $("s-trade-save-profile").addEventListener("click", async () => {
    if (devMockActive) { status.textContent = "Profile editing is disabled in the local mock preview."; return; }
    if (!currentUserId) return;
    const displayName = $("s-trade-display-name").value.trim();
    if (displayName.length > 80) { status.textContent = "Display name must be 80 characters or fewer."; return; }
    $("s-trade-save-profile").disabled = true;
    try {
      const { data, error } = await supabase.auth.updateUser({ data: { display_name: displayName } });
      if (error) throw error;
      if (data.user?.id !== currentUserId) throw new Error("Account changed. Please sign in again.");
      status.textContent = "Profile saved.";
    } catch (error) { status.textContent = error.message || "Profile could not be saved."; }
    finally { $("s-trade-save-profile").disabled = false; }
  });
  $("s-trade-refresh-session").addEventListener("click", async () => {
    if (devMockActive) { status.textContent = "There is no authenticated session to refresh in mock preview."; return; }
    $("s-trade-refresh-session").disabled = true;
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) throw error;
      await syncAuth(data.session);
    } catch (error) { status.textContent = error.message || "Session refresh failed."; }
    finally { $("s-trade-refresh-session").disabled = false; }
  });
  $("s-trade-refresh-wallet").addEventListener("click", async () => {
    if (devMockActive) { status.textContent = "Wallet refresh is disabled in the local mock preview."; return; }
    if (!currentUserId) return;
    try { await loadWallet(currentUserId); status.textContent = "Wallet refreshed."; }
    catch (error) { status.textContent = error.message || "Wallet refresh failed."; }
  });
  $("s-trade-sign-out").addEventListener("click", async () => {
    if (devMockActive) {
      devMockActive = false;
      currentUserId = null;
      authSequence++;
      clearWallet();
      privatePanel.hidden = true;
      phonePanel.hidden = false;
      if (isLocalDevelopment) mockButton.hidden = false;
      status.textContent = "Development mock session ended. Sign in with Supabase for authenticated access.";
      return;
    }
    $("s-trade-sign-out").disabled = true;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      status.textContent = "Signed out.";
    } catch (error) { status.textContent = error.message || "Sign out failed."; }
    finally { $("s-trade-sign-out").disabled = false; }
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    queueMicrotask(() => syncAuth(session));
  });
  supabase.auth.getSession().then(({ data, error }) => {
    if (error) status.textContent = "Session could not be restored.";
    else syncAuth(data.session);
  });
}
