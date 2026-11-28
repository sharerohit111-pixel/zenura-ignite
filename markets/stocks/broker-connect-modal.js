/* Broker connect modal. OAuth actions delegate only to implemented provider adapters. */
(function () {
  "use strict";
  const root = document.getElementById("broker-connect-overlay");
  if (!root) return;
  const providers = [
    { id:"upstox", name:"Upstox", mark:"u", tag:"API ACCESS", note:"₹0 account opening*", url:"https://upstox.com/" },
    { id:"fyers", name:"FYERS", mark:"F", tag:"API ACCESS", note:"Broker API access", url:"https://fyers.in/" },
    { id:"angel_one", name:"Angel One", mark:"A", tag:"API ACCESS", note:"SmartAPI", url:"https://www.angelone.in/" },
    { id:"kotak_neo", name:"Kotak Neo", mark:"K", tag:"VERIFYING", pending:true, note:"Pricing verification pending", url:"https://www.kotakneo.com/" }
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
      head.append(el("span", "broker-connect-tag" + (p.pending ? " pending" : ""), p.tag));
      const button = el("button", "broker-connect-action", p.pending ? "Not available yet" : "Connect & Login");
      button.type = "button";
      button.dataset.provider = p.id;
      button.disabled = !!p.pending;
      if (p.id !== "upstox") button.title = "This broker's OAuth route is not yet integrated in this release.";
      card.append(head, button);
      loginGrid.append(card);

      const account = el("article", "broker-account-card");
      const title = el("div", "broker-account-title");
      title.append(logo(p.mark), el("span", "", p.name));
      account.append(title, el("p", "broker-account-note", p.note));
      const link = el("a", "broker-account-link", "Open Account ↗");
      link.href = p.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer sponsored";
      account.append(link);
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
      } else {
        feedback.textContent = providerButton.dataset.provider.toUpperCase().replace("_", " ") + " login integration is being completed. Demo / Replay remains available.";
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
