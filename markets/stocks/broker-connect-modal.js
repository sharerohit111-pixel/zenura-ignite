"use strict";
(function () {
  const root = document.getElementById("broker-connect-overlay");
  if (!root) return;
  const referralConfig = window.ZENURA_BROKER_REFERRALS || {};
  const providers = [
    { id: "upstox", name: "Upstox", mark: "u", tag: "BROKER API", note: "Zero AMC and eligible brokerage offers*", referralUrl: referralConfig.upstox || "https://upstox.onelink.me/0H1s/5CAYMN" },
    { id: "fyers", name: "FYERS", mark: "F", tag: "BROKER API", note: "Referral code FRN9GVV · Up to ₹2,000 FYERS Credits*", referralUrl: referralConfig.fyers || "https://fyers.onelink.me/cj1P/l3nujhwy" },
    { id: "angel_one", name: "Angel One", mark: "A", tag: "SMARTAPI", note: "Free Demat account offer and other benefits*", referralUrl: referralConfig.angel_one || "https://angel-one.onelink.me/Wjgr/gw4o5lz2" }
  ];
  const feedback = root.querySelector("[data-broker-feedback]");
  const status = document.getElementById("connection-title");
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function logo(mark) { return el("span", "broker-connect-logo", mark); }
  function render() {
    const loginGrid = root.querySelector("[data-broker-login-grid]");
    const accountGrid = root.querySelector("[data-broker-account-grid]");
    providers.forEach((p) => {
      const card = el("article", "broker-connect-card");
      const head = el("div", "broker-connect-card-head");
      head.append(logo(p.mark), el("h3", "", p.name));
      head.append(el("span", "broker-connect-tag", p.tag));
      const button = el("button", "broker-connect-action", "Connect & Login");
      button.type = "button";
      button.dataset.provider = p.id;
      if (p.id === "angel_one") button.hidden = true;
      card.append(head, button);
      if (p.id === "fyers") {
        const brokerStatus = el("small", "broker-connect-status", "Checking FYERS connection…");
        brokerStatus.dataset.fyersStatus = "true";
        const disconnect = el("button", "broker-connect-disconnect", "Disconnect FYERS");
        disconnect.type = "button";
        disconnect.dataset.fyersDisconnect = "true";
        disconnect.hidden = true;
        card.append(brokerStatus, disconnect);
      }
      if (p.id === "angel_one") {
        const form = el("div", "angel-one-login-form");
        form.innerHTML = '<label>Client ID<input data-angel-client autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="20"></label><label>Trading PIN<input data-angel-pin type="password" inputmode="numeric" autocomplete="new-password" maxlength="6"></label><label>6-digit TOTP<input data-angel-totp type="password" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label><button type="button" class="broker-connect-action" data-angel-login>Connect Angel One</button><small data-angel-status class="broker-connect-status">PIN and TOTP are sent only to the secure server for login and are not saved.</small><button type="button" class="broker-connect-disconnect" data-angel-disconnect hidden>Disconnect Angel One</button>';
        card.append(form);
      }
      loginGrid.append(card);

      const account = el("article", "broker-account-card");
      const title = el("div", "broker-account-title");
      title.append(logo(p.mark), el("span", "", p.name));
      account.append(title, el("p", "broker-account-note", p.note));
      const link = el("a", "broker-account-link", "Open Free Account ↗");
      link.href = p.referralUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer sponsored";
      account.append(link, el("small", "broker-affiliate-disclosure", "Referral link · S-TRADE may earn a commission*"));
      accountGrid.append(account);
    });
  }
  async function refreshFyersStatus() {
    const statusNode = root.querySelector("[data-fyers-status]");
    const disconnectNode = root.querySelector("[data-fyers-disconnect]");
    if (!statusNode || typeof window.ZENURA_GET_BROKER_STATUS !== "function") {
      if (statusNode) statusNode.textContent = "Secure login status unavailable until sign-in.";
      return;
    }
    try {
      const result = await window.ZENURA_GET_BROKER_STATUS("fyers");
      statusNode.textContent = result.connected
        ? "CONNECTED · expires " + new Date(result.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST"
        : "NOT CONNECTED";
      disconnectNode.hidden = !result.connected;
    } catch (_) {
      statusNode.textContent = "Sign in to check FYERS connection.";
      disconnectNode.hidden = true;
    }
  }
  async function refreshAngelOneStatus() {
    const node = root.querySelector("[data-angel-status]");
    const disconnect = root.querySelector("[data-angel-disconnect]");
    if (!node || typeof window.ZENURA_ANGEL_ONE_STATUS !== "function") return;
    try {
      const result = await window.ZENURA_ANGEL_ONE_STATUS();
      if (result.connected) {
        node.textContent = "CONNECTED · " + (result.account || "Angel One") + " · expires " + new Date(result.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST";
        disconnect.hidden = false;
      } else {
        node.textContent = "NOT CONNECTED · PIN and TOTP are never stored.";
        disconnect.hidden = true;
      }
    } catch (_) {
      node.textContent = "Sign in to check Angel One connection.";
      disconnect.hidden = true;
    }
  }
  function open() { root.hidden = false; document.body.classList.add("broker-connect-open"); }
  function close() { root.hidden = true; document.body.classList.remove("broker-connect-open"); }
  render();
  refreshFyersStatus();
  refreshAngelOneStatus();
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (target.matches("[data-close-broker-modal]") || target === root) close();
    const angelDisconnect = target.closest("[data-angel-disconnect]");
    if (angelDisconnect) {
      angelDisconnect.disabled = true;
      const node = root.querySelector("[data-angel-status]");
      if (node) node.textContent = "Disconnecting Angel One…";
      Promise.resolve().then(() => window.ZENURA_ANGEL_ONE_DISCONNECT()).then((result) => {
        if (node) node.textContent = result.providerRevocation === "confirmed"
          ? "Disconnected; Angel One confirmed logout." : "Disconnected locally; provider-side logout not confirmed.";
        refreshAngelOneStatus();
      }).catch(() => { if (node) node.textContent = "Disconnect failed. Please retry."; })
        .finally(() => { angelDisconnect.disabled = false; });
      return;
    }
    const angelLogin = target.closest("[data-angel-login]");
    if (angelLogin) {
      const client = root.querySelector("[data-angel-client]");
      const pin = root.querySelector("[data-angel-pin]");
      const totp = root.querySelector("[data-angel-totp]");
      const node = root.querySelector("[data-angel-status]");
      const credentials = { clientcode: client.value.trim(), pin: pin.value, totp: totp.value };
      pin.value = ""; totp.value = "";
      angelLogin.disabled = true;
      if (node) node.textContent = "Authenticating securely with Angel One…";
      Promise.resolve().then(() => window.ZENURA_ANGEL_ONE_LOGIN(credentials)).then((result) => {
        if (node) node.textContent = "CONNECTED · session expires " + new Date(result.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST";
        client.value = "";
        refreshAngelOneStatus();
      }).catch((error) => {
        if (node) node.textContent = error?.message || "Angel One login failed. Check details and current TOTP.";
      }).finally(() => {
        credentials.pin = ""; credentials.totp = "";
        pin.value = ""; totp.value = "";
        angelLogin.disabled = false;
      });
      return;
    }
    const disconnectFyers = target.closest("[data-fyers-disconnect]");
    if (disconnectFyers) {
      disconnectFyers.disabled = true;
      feedback.textContent = "Disconnecting FYERS…";
      Promise.resolve().then(() => {
        if (typeof window.ZENURA_DISCONNECT_BROKER !== "function") throw new Error("FYERS disconnect is not ready.");
        return window.ZENURA_DISCONNECT_BROKER("fyers");
      }).then(() => {
        feedback.textContent = "FYERS disconnected from this app.";
        refreshFyersStatus();
      }).catch((error) => {
        feedback.textContent = error?.message || "FYERS disconnect failed.";
      }).finally(() => { disconnectFyers.disabled = false; });
      return;
    }
    const providerButton = target.closest("[data-provider]");
    if (providerButton) {
      if (providerButton.dataset.provider === "upstox") {
        const existing = document.getElementById("upstox-connect");
        if (existing) existing.click();
        else feedback.textContent = "Upstox authorization control is not available on this page.";
      } else if (providerButton.dataset.provider === "fyers") {
        providerButton.disabled = true;
        feedback.textContent = "Preparing secure FYERS authorization…";
        Promise.resolve().then(() => {
          if (typeof window.ZENURA_START_BROKER_OAUTH !== "function") throw new Error("Secure FYERS login is not ready on this page.");
          return window.ZENURA_START_BROKER_OAUTH("fyers");
        }).catch((error) => {
          feedback.textContent = error?.message || "FYERS authorization could not be started.";
          providerButton.disabled = false;
        });
      }
    }
    if (target.closest("[data-demo-mode]")) {
      close();
      feedback.textContent = "";
      window.dispatchEvent(new CustomEvent("zenura-demo-mode-requested"));
      const banner = document.getElementById("connection-sub");
      if (banner) banner.textContent = "Demo / Replay selected. No broker login required.";
    }
  });
  window.ZENURA_BROKER_CONNECT_MODAL = Object.freeze({ open, close });
  window.addEventListener("zenura-broker-connection-ready", close);
  window.addEventListener("zenura-broker-connection-expired", open);
  window.addEventListener("zenura-broker-connection-missing", open);
  window.addEventListener("zenura-fyers-connection-updated", refreshFyersStatus);
  window.addEventListener("zenura-angel-one-connection-updated", refreshAngelOneStatus);
  window.addEventListener("zenura-market-auth-ready", refreshFyersStatus);
  window.addEventListener("zenura-market-auth-ready", refreshAngelOneStatus);
  window.addEventListener("zenura-market-auth-ready", (event) => {
    if (event.detail?.signedIn && status?.textContent?.includes("AUTHORIZED")) close();
  });
})();
