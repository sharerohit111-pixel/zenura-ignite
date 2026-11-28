"use strict";
(function () {
  const root = document.getElementById("broker-connect-overlay");
  if (!root) return;
  const providers = [
    { id: "upstox", name: "Upstox", mark: "u", tag: "BROKER API", note: "Zero AMC and eligible brokerage offers*", referralUrl: "https://upstox.onelink.me/0H1s/5CAYMN" },
    { id: "fyers", name: "FYERS", mark: "F", tag: "BROKER API", note: "Referral code FRN9GVV · Up to ₹2,000 FYERS Credits*", referralUrl: "https://fyers.onelink.me/cj1P/l3nujhwy" },
    { id: "angel_one", name: "Angel One", mark: "A", tag: "SMARTAPI", note: "Free Demat account offer and other benefits*", referralUrl: "https://angel-one.onelink.me/Wjgr/gw4o5lz2" }
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
      card.append(head, button);
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
  function open() { root.hidden = false; document.body.classList.add("broker-connect-open"); }
  function close() { root.hidden = true; document.body.classList.remove("broker-connect-open"); }
  render();
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (target.matches("[data-close-broker-modal]") || target === root) close();
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
      } else {
        feedback.textContent = "ANGEL ONE secure SmartAPI session integration is still in progress. Demo / Replay remains available.";
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
  window.addEventListener("zenura-market-auth-ready", (event) => {
    if (event.detail?.signedIn && status?.textContent?.includes("AUTHORIZED")) close();
  });
})();
