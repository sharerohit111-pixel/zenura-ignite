/* ZENURA IGNITE — isolated Paper Trading order workspace.
 * Uses only the currently verified Indian-market gateway contracts.
 * LIMIT submission/cancellation stay disabled until backend routes support them.
 */
(() => {
  'use strict';
  const gateway = (document.querySelector('meta[name="market-gateway-url"]')?.content || '').trim().replace(/\/+$/, '');
  const $ = id => document.getElementById(id);
  const ticket = $('paper-order-ticket');
  if (!ticket) return;

  const typeButtons = [...ticket.querySelectorAll('[data-order-type]')];
  const limitPrice = $('paper-limit-price');
  const referencePrice = $('paper-reference-price');
  const qty = $('paper-quantity');
  const buy = $('paper-buy');
  const sell = $('paper-sell');
  const status = $('paper-order-status');
  const estimate = $('paper-order-estimate');
  const limitNotice = $('limit-api-notice');
  const cashAvailable = $('paper-cash-available');
  const cashReserved = $('paper-cash-reserved');
  const sharesAvailable = $('paper-shares-available');
  const sharesReserved = $('paper-shares-reserved');
  const ordersBody = $('paper-orders-workspace-body');
  const ordersStatus = $('paper-orders-workspace-status');
  const refresh = $('paper-orders-workspace-refresh');
  const tabs = [...document.querySelectorAll('[data-order-filter]')];
  const tradeBody = $('paper-trades-workspace-body');
  const tradeStatus = $('paper-trades-workspace-status');
  const langButton = $('paper-language-toggle');
  let selectedType = 'MARKET';
  let currentOrders = [];
  let currentFilter = 'ALL';
  let requestSeq = 0;
  let language = 'en';
  let latestCashPaise = null;

  const translations = {
    'Paper Trading Order Ticket':'पेपर ट्रेडिंग ऑर्डर टिकट',
    'VIRTUAL CASH':'वर्चुअल नकद','REALIZED P&L':'वास्तविक P&L','DATE & TIME':'तारीख और समय','STOCK':'शेयर','SIDE':'प्रकार','TYPE':'ऑर्डर प्रकार','QTY':'मात्रा','EXECUTION PRICE':'एक्जीक्यूशन कीमत','ACTION':'कार्रवाई',
    'Pending & Order Book':'पेंडिंग और ऑर्डर बुक','Order History':'ऑर्डर हिस्ट्री','Portfolio & P&L':'पोर्टफोलियो और P&L',
    'MARKET':'मार्केट','LIMIT':'लिमिट','Reference / live price':'संदर्भ / लाइव कीमत',
    'Limit price (₹)':'लिमिट कीमत (₹)','Quantity':'मात्रा',
    'Estimated order value':'अनुमानित ऑर्डर मूल्य','BUY':'खरीदें','SELL':'बेचें',
    'Pending & Order Book':'पेंडिंग और ऑर्डर बुक','ALL':'सभी','OPEN / PENDING':'खुले / पेंडिंग',
    'FILLED':'पूरे हुए','CANCELLED':'रद्द किए गए','Refresh orders':'ऑर्डर रीफ्रेश करें',
    'Available Cash':'उपलब्ध नकद','Reserved Cash':'आरक्षित नकद',
    'Available Shares':'उपलब्ध शेयर','Reserved Shares':'आरक्षित शेयर',
    'Trade History':'ट्रेड हिस्ट्री','Execution Price':'एक्जीक्यूशन कीमत',
    'Date & Time':'तारीख और समय','Order':'ऑर्डर','Status':'स्थिति',
    'No orders match this filter.':'इस फ़िल्टर में कोई ऑर्डर नहीं है।',
    'Sign in to view private orders.':'निजी ऑर्डर देखने के लिए साइन इन करें।',
    'LIMIT orders are not enabled by the current backend API. No order was sent.':'मौजूदा बैकएंड API में LIMIT ऑर्डर उपलब्ध नहीं हैं। कोई ऑर्डर नहीं भेजा गया।',
    'Cancel is unavailable: the backend has no verified cancel endpoint.':'रद्द करने की सुविधा उपलब्ध नहीं: बैकएंड में सत्यापित cancel endpoint नहीं है।',
    'Not exposed by backend':'बैकएंड से उपलब्ध नहीं','CANCEL UNAVAILABLE':'रद्द करना उपलब्ध नहीं','BUY':'खरीदें','SELL':'बेचें','PENDING':'पेंडिंग','OPEN':'खुला','PARTIALLY_FILLED':'आंशिक रूप से पूरा','CANCELLED':'रद्द','REJECTED':'अस्वीकृत'
  };
  const translate = value => language === 'hi' ? (translations[value] || value) : value;
  function applyLanguage() {
    document.querySelectorAll('[data-paper-en]').forEach(el => {
      const english = el.getAttribute('data-paper-en');
      const textNode = [...el.childNodes].find(node => node.nodeType === 3);
      if (textNode) textNode.textContent = translate(english);
      else el.insertBefore(document.createTextNode(translate(english)), el.firstChild);
    });
    if (langButton) langButton.textContent = language === 'en' ? 'हिन्दी' : 'English';
    ticket.querySelectorAll('[data-order-type]').forEach(button => {
      const type = button.dataset.orderType;
      button.textContent = translate(type);
    });
    tabs.forEach(button => { const key = button.dataset.orderFilter === 'OPEN' ? 'OPEN / PENDING' : button.dataset.orderFilter; button.textContent = translate(key); });
    renderOrders();
    renderTrades();
  }
  langButton?.addEventListener('click', () => {
    language = language === 'en' ? 'hi' : 'en';
    applyLanguage();
  });

  function money(paise) {
    if (!Number.isSafeInteger(paise)) return '—';
    return '₹' + (paise / 100).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  function safeText(value) { return String(value ?? '—'); }
  function showMessage(target, message, kind = 'info') {
    if (!target) return;
    target.textContent = message;
    target.dataset.state = kind;
  }
  function livePriceValue() {
    const text = $('selected-price')?.textContent || '';
    const match = text.replace(/,/g, '').match(/(?:₹|INR\s*)(\d+(?:\.\d+)?)/i);
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function syncReferencePrice() {
    const n = livePriceValue();
    referencePrice.value = n === null ? '' : n.toFixed(2);
    updateEstimate();
  }
  function updateEstimate() {
    const quantity = Number(qty?.value);
    const price = selectedType === 'LIMIT' ? Number(limitPrice?.value) : Number(referencePrice?.value);
    const validQty = Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 1000000;
    const validPrice = Number.isFinite(price) && price > 0;
    estimate.textContent = validQty && validPrice
      ? money(Math.round(price * 100) * quantity)
      : '—';
  }
  let marketBuyDisabled = buy.disabled, marketSellDisabled = sell.disabled;
  let lastBuyDisabled = buy.disabled, lastSellDisabled = sell.disabled;
  function trackMarketButtonAvailability() {
    if (selectedType !== 'LIMIT') return;
    if (buy.disabled !== lastBuyDisabled) marketBuyDisabled = buy.disabled;
    if (sell.disabled !== lastSellDisabled) marketSellDisabled = sell.disabled;
    lastBuyDisabled = buy.disabled; lastSellDisabled = sell.disabled;
    if (!buy.disabled) { buy.disabled = true; lastBuyDisabled = true; }
    if (!sell.disabled) { sell.disabled = true; lastSellDisabled = true; }
  }
  if (typeof MutationObserver !== 'undefined') {
    const buttonObserver = new MutationObserver(trackMarketButtonAvailability);
    buttonObserver.observe(buy, {attributes:true,attributeFilter:['disabled']});
    buttonObserver.observe(sell, {attributes:true,attributeFilter:['disabled']});
  }
  function setOrderType(type) {
    selectedType = type;
    typeButtons.forEach(button => {
      const active = button.dataset.orderType === type;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    limitPrice.disabled = type !== 'LIMIT';
    referencePrice.closest('label').hidden = type === 'LIMIT';
    limitPrice.closest('label').hidden = type !== 'LIMIT';
    if (type === 'LIMIT') {
      marketBuyDisabled = buy.disabled; marketSellDisabled = sell.disabled;
      buy.disabled = true; sell.disabled = true;
      lastBuyDisabled = true; lastSellDisabled = true;
      showMessage(limitNotice, translate('LIMIT orders are not enabled by the current backend API. No order was sent.'), 'warning');
      status.textContent = translate('LIMIT orders are not enabled by the current backend API. No order was sent.');
    } else {
      limitNotice.hidden = true;
      buy.disabled = marketBuyDisabled; sell.disabled = marketSellDisabled;
      lastBuyDisabled = buy.disabled; lastSellDisabled = sell.disabled;
      status.textContent = 'MARKET orders use a fresh server-verified Upstox quote. The displayed price is indicative only.';
    }
    updateEstimate();
  }
  typeButtons.forEach(button => button.addEventListener('click', () => setOrderType(button.dataset.orderType)));
  window.addEventListener('zenura-market-auth-ready', trackMarketButtonAvailability);
  qty?.addEventListener('input', updateEstimate);
  limitPrice?.addEventListener('input', updateEstimate);
  const selectedPrice = $('selected-price');
  if (selectedPrice && typeof MutationObserver !== 'undefined') {
    new MutationObserver(syncReferencePrice).observe(selectedPrice, {childList:true,subtree:true,characterData:true});
  }
  syncReferencePrice();

  async function authHeaders() {
    const connector = window.ZENURA_MARKET_CONNECTOR;
    if (!gateway || !connector?.getIdToken || !connector.getUserId?.()) throw new Error(translate('Sign in to view private orders.'));
    return {Authorization:'Bearer ' + await connector.getIdToken(), Accept:'application/json'};
  }
  function orderRow(order, showCancel = false) {
    const tr = document.createElement('tr');
    const when = order.createdAt ? new Date(order.createdAt).toLocaleString('en-IN', {dateStyle:'medium',timeStyle:'short'}) : '—';
    const price = Number.isSafeInteger(order.executionPricePaise) ? money(order.executionPricePaise) : '—';
    const values = [when, order.tradingSymbol, translate(String(order.side || '')), translate(String(order.orderType || 'MARKET')), order.quantity, price, translate(String(order.status || ''))];
    values.forEach(value => {
      const td = document.createElement('td');
      td.textContent = safeText(value);
      tr.append(td);
    });
    if (showCancel) {
      const td = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'paper-cancel-unavailable';
      button.disabled = true;
      button.textContent = translate('CANCEL UNAVAILABLE');
      button.title = translate('Cancel is unavailable: the backend has no verified cancel endpoint.');
      td.append(button);
      tr.append(td);
    }
    return tr;
  }
  function renderOrders() {
    if (!ordersBody) return;
    ordersBody.textContent = '';
    const filtered = currentOrders.filter(order => {
      if (currentFilter === 'ALL') return true;
      if (currentFilter === 'OPEN') return ['PENDING','OPEN','PARTIALLY_FILLED'].includes(String(order.status).toUpperCase());
      return String(order.status).toUpperCase() === currentFilter;
    });
    if (!filtered.length) {
      const tr = document.createElement('tr'), td = document.createElement('td');
      td.colSpan = 8; td.textContent = translate('No orders match this filter.');
      tr.append(td); ordersBody.append(tr); return;
    }
    filtered.forEach(order => ordersBody.append(orderRow(order, ['PENDING','OPEN','PARTIALLY_FILLED'].includes(String(order.status).toUpperCase()))));
  }
  function renderTrades() {
    if (!tradeBody) return;
    tradeBody.textContent = '';
    const filled = currentOrders.filter(order => String(order.status).toUpperCase() === 'FILLED');
    if (!filled.length) {
      const tr = document.createElement('tr'), td = document.createElement('td');
      td.colSpan = 6; td.textContent = translate('No orders match this filter.');
      tr.append(td); tradeBody.append(tr); return;
    }
    filled.forEach(order => {
      const tr = document.createElement('tr');
      const when = order.createdAt ? new Date(order.createdAt).toLocaleString('en-IN', {dateStyle:'medium',timeStyle:'short'}) : '—';
      [when,order.tradingSymbol,translate(String(order.side || '')),order.quantity,money(order.executionPricePaise),translate(String(order.orderType || 'MARKET'))].forEach(value => {
        const td = document.createElement('td'); td.textContent = safeText(value); tr.append(td);
      });
      tradeBody.append(tr);
    });
  }
  tabs.forEach(button => button.addEventListener('click', () => {
    currentFilter = button.dataset.orderFilter;
    tabs.forEach(tab => { const active = tab === button; tab.classList.toggle('active', active); tab.setAttribute('aria-pressed', String(active)); });
    renderOrders();
  }));

  async function loadBalances() {
    const connector = window.ZENURA_MARKET_CONNECTOR, uid = connector?.getUserId?.();
    if (!uid || !gateway) return;
    try {
      const headers = await authHeaders();
      const [accountResponse, portfolioResponse] = await Promise.all([
        fetch(gateway + '/paper/account', {headers}),
        fetch(gateway + '/paper/portfolio', {headers})
      ]);
      const [account, portfolio] = await Promise.all([accountResponse.json(), portfolioResponse.json()]);
      if (connector.getUserId() !== uid) return;
      if (!accountResponse.ok) throw new Error(account.error || 'Account balance unavailable.');
      if (!portfolioResponse.ok) throw new Error(portfolio.error || 'Share availability could not be verified.');
      latestCashPaise = Number.isSafeInteger(account.cashPaise) ? account.cashPaise : null;
      cashAvailable.textContent = money(latestCashPaise);
      cashReserved.textContent = translate('Not exposed by backend');
      sharesAvailable.textContent = translate('Not exposed by backend');
      sharesReserved.textContent = translate('Not exposed by backend');
    } catch (error) {
      cashAvailable.textContent = '—'; cashReserved.textContent = '—';
      sharesAvailable.textContent = '—'; sharesReserved.textContent = '—';
      showMessage(ordersStatus, error.message || 'Could not load balances.', 'error');
    }
  }
  async function loadOrders() {
    const connector = window.ZENURA_MARKET_CONNECTOR, uid = connector?.getUserId?.(), seq = ++requestSeq;
    if (!uid || !gateway) {
      currentOrders = [];
      showMessage(ordersStatus, translate('Sign in to view private orders.'), 'warning');
      renderOrders(); renderTrades(); return;
    }
    showMessage(ordersStatus, 'Loading orders from your private paper account…', 'loading');
    try {
      const headers = await authHeaders();
      const response = await fetch(gateway + '/paper/orders?limit=100', {headers});
      const data = await response.json();
      if (seq !== requestSeq || connector.getUserId() !== uid) return;
      if (!response.ok) throw new Error(data.error || 'Order history unavailable.');
      currentOrders = Array.isArray(data.orders) ? data.orders : [];
      showMessage(ordersStatus, currentOrders.length ? currentOrders.length + ' orders loaded from backend. ' + (data.hasMore ? 'More older orders are available in the original history.' : '') : 'No paper orders recorded yet.', 'success');
      showMessage(tradeStatus, 'Trade history is derived only from backend orders with FILLED status.', 'info');
      renderOrders(); renderTrades();
    } catch (error) {
      if (seq !== requestSeq || connector.getUserId() !== uid) return;
      currentOrders = [];
      showMessage(ordersStatus, error.message || 'Could not load orders.', 'error');
      renderOrders(); renderTrades();
    }
  }
  async function refreshAll() { await Promise.all([loadBalances(), loadOrders()]); }
  refresh?.addEventListener('click', refreshAll);
  window.addEventListener('zenura-market-auth-ready', event => {
    if (!event.detail?.signedIn) {
      requestSeq++; currentOrders = [];
      cashAvailable.textContent = '—'; cashReserved.textContent = '—';
      sharesAvailable.textContent = '—'; sharesReserved.textContent = '—';
      showMessage(ordersStatus, translate('Sign in to view private orders.'), 'warning');
      renderOrders(); renderTrades();
      return;
    }
    refreshAll();
  });
  if (window.ZENURA_MARKET_CONNECTOR?.getUserId?.()) refreshAll();
  setOrderType('MARKET');
  applyLanguage();
})();