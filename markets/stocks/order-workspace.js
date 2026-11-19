/* ZENURA IGNITE — Paper Trading order workspace.
 * Uses the verified authenticated Indian-market API, including LIMIT reserve/cancel.
 * No local simulation of fills or cancellations.
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
  const loadMore = $('paper-orders-workspace-more');
  const tabs = [...document.querySelectorAll('[data-order-filter]')];
  const tradeBody = $('paper-trades-workspace-body');
  const tradeStatus = $('paper-trades-workspace-status');
  const langButton = $('paper-language-toggle');

  let selectedType = 'MARKET';
  let currentOrders = [];
  let currentFilter = 'ALL';
  let requestSeq = 0;
  let language = 'en';
  let nextCursor = null;
  let hasMore = false;
  let limitSubmitting = false;
  let balanceRequest = 0;

  const translations = {
    'Paper Trading Order Ticket':'पेपर ट्रेडिंग ऑर्डर टिकट',
    'VIRTUAL CASH':'वर्चुअल नकद','REALIZED P&L':'वास्तविक P&L','DATE & TIME':'तारीख और समय','STOCK':'शेयर','SIDE':'प्रकार','TYPE':'ऑर्डर प्रकार','QTY':'मात्रा','EXECUTION PRICE':'एक्जीक्यूशन कीमत','ACTION':'कार्रवाई','Limit Price':'लिमिट कीमत','Order':'ऑर्डर','Status':'स्थिति',
    'Pending & Order Book':'पेंडिंग और ऑर्डर बुक',
    'Reference / live price':'संदर्भ / लाइव कीमत','Limit price (₹)':'लिमिट कीमत (₹)',
    'Quantity':'मात्रा','Estimated order value':'अनुमानित ऑर्डर मूल्य',
    'BUY':'खरीदें','SELL':'बेचें','MARKET':'मार्केट','LIMIT':'लिमिट',
    'ALL':'सभी','OPEN / PENDING':'खुले / पेंडिंग','FILLED':'पूरे हुए','CANCELLED':'रद्द किए गए',
    'Refresh orders':'ऑर्डर रीफ्रेश करें','Load older orders':'पुराने ऑर्डर लोड करें',
    'Available Cash':'उपलब्ध नकद','Reserved Cash':'आरक्षित नकद',
    'Available Shares':'उपलब्ध शेयर','Reserved Shares':'आरक्षित शेयर',
    'Trade History':'ट्रेड हिस्ट्री','Date & Time':'तारीख और समय','Order':'ऑर्डर',
    'Status':'स्थिति','Execution Price':'एक्जीक्यूशन कीमत','Limit Price':'लिमिट कीमत',
    'Cancel':'रद्द करें','CANCELLED':'रद्द','PENDING':'पेंडिंग','OPEN':'खुला',
    'PARTIALLY_FILLED':'आंशिक रूप से पूरा','FILLED':'पूरे हुए','REJECTED':'अस्वीकृत',
    'BUY':'खरीदें','SELL':'बेचें','Not available':'उपलब्ध नहीं',
    'No orders match this filter.':'इस फ़िल्टर में कोई ऑर्डर नहीं है।',
    'Sign in to view private orders.':'निजी ऑर्डर देखने के लिए साइन इन करें।',
    'Select a verified NSE/BSE cash equity first.':'पहले सत्यापित NSE/BSE कैश इक्विटी चुनें।',
    'LIMIT orders are sent to your private paper account and reserve virtual cash or shares.':'LIMIT ऑर्डर आपके निजी पेपर अकाउंट में भेजे जाते हैं और वर्चुअल नकद या शेयर आरक्षित करते हैं।',
    'LIMIT order submitted and reservation confirmed.':'LIMIT ऑर्डर जमा हुआ और आरक्षण की पुष्टि हुई।',
    'Order cancelled and reservation released.':'ऑर्डर रद्द हुआ और आरक्षण मुक्त हुआ।',
    'A previous LIMIT order response is uncertain. Retry with the same stock, side, quantity and price before changing the ticket.':'पिछले LIMIT ऑर्डर का जवाब स्पष्ट नहीं है। टिकट बदलने से पहले उसी शेयर, प्रकार, मात्रा और कीमत के साथ दोबारा प्रयास करें।',
    'Cancellation is available only for pending LIMIT orders.':'रद्द करने की सुविधा केवल पेंडिंग LIMIT ऑर्डर के लिए उपलब्ध है।',
    'Loading orders from your private paper account…':'आपके निजी पेपर अकाउंट से ऑर्डर लोड हो रहे हैं…',
    'No paper orders recorded yet.':'अभी कोई पेपर ऑर्डर दर्ज नहीं है।',
    'Loading balances…':'बैलेंस लोड हो रहा है…','Balances and reservations refreshed from your private paper account.':'आपके निजी पेपर अकाउंट का बैलेंस और आरक्षण अपडेट हुआ।','Trade history includes only backend orders with FILLED status.':'ट्रेड हिस्ट्री में केवल बैकएंड के FILLED ऑर्डर शामिल हैं।','Loading older orders…':'पुराने ऑर्डर लोड हो रहे हैं…','orders loaded from backend.':'ऑर्डर बैकएंड से लोड हुए।'
  };
  const translate = value => language === 'hi' ? (translations[value] || value) : value;

  function money(paise) {
    if (!Number.isSafeInteger(paise)) return '—';
    return '₹' + (paise / 100).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  function showMessage(target, message, kind = 'info') {
    if (!target) return;
    target.textContent = message;
    target.dataset.state = kind;
  }
  function livePriceValue() {
    const text = $('selected-price')?.textContent || '';
    const match = text.replace(/,/g, '').match(/(?:₹|INR\s*)(\d+(?:\.\d+)?)/i);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  function syncReferencePrice() {
    const value = livePriceValue();
    referencePrice.value = value === null ? '' : value.toFixed(2);
    updateEstimate();
  }
  function updateEstimate() {
    const quantity = Number(qty?.value);
    const price = selectedType === 'LIMIT' ? Number(limitPrice?.value) : Number(referencePrice?.value);
    const validQty = Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 1000000;
    const validPrice = Number.isFinite(price) && price > 0;
    estimate.textContent = validQty && validPrice ? money(Math.round(price * 100) * quantity) : '—';
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
    [buy, sell].forEach(button => {
      if (type === 'LIMIT') {
        button.setAttribute('aria-disabled', 'true');
        button.classList.add('paper-limit-blocked');
      } else {
        button.removeAttribute('aria-disabled');
        button.classList.remove('paper-limit-blocked');
      }
    });
    if (type === 'LIMIT') {
      limitNotice.hidden = false;
      showMessage(limitNotice, translate('LIMIT orders are sent to your private paper account and reserve virtual cash or shares.'), 'info');
      status.textContent = translate('LIMIT orders are sent to your private paper account and reserve virtual cash or shares.');
    } else {
      limitNotice.hidden = true;
      status.textContent = 'MARKET orders use the existing server-verified Upstox quote flow. Displayed price is indicative only.';
    }
    updateEstimate();
  }
  typeButtons.forEach(button => button.addEventListener('click', () => setOrderType(button.dataset.orderType)));
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
  function selectedInstrument() {
    const key = $('selected-symbol')?.textContent?.trim() || '';
    const symbol = $('selected-name')?.textContent?.trim() || '';
    if (!key.includes('|') || !symbol || /no instrument selected|choose an instrument/i.test(symbol)) return null;
    return {instrumentKey:key, tradingSymbol:symbol};
  }
  function limitStorageKey(uid) { return 'zenura-paper-limit-pending-v1:' + uid; }
  function readPendingLimit(uid) {
    try {
      const raw = sessionStorage.getItem(limitStorageKey(uid));
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function savePendingLimit(uid, pending) {
    try { sessionStorage.setItem(limitStorageKey(uid), JSON.stringify(pending)); return true; }
    catch (_) { return false; }
  }
  function clearPendingLimit(uid) {
    try { sessionStorage.removeItem(limitStorageKey(uid)); } catch (_) {}
  }
  async function submitLimitOrder(side) {
    if (limitSubmitting) return;
    const connector = window.ZENURA_MARKET_CONNECTOR, uid = connector?.getUserId?.();
    if (!uid || !gateway) {
      showMessage(status, translate('Sign in to view private orders.'), 'warning');
      return;
    }
    const instrument = selectedInstrument();
    if (!instrument) {
      showMessage(status, translate('Select a verified NSE/BSE cash equity first.'), 'warning');
      return;
    }
    const quantity = Number(qty.value);
    const price = Number(limitPrice.value);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) {
      showMessage(status, 'Enter a whole-number quantity between 1 and 1,000,000.', 'error'); return;
    }
    if (!Number.isFinite(price) || price <= 0 || price > 99999999 || !/^\d{1,8}(?:\.\d{1,2})?$/.test(limitPrice.value.trim())) {
      showMessage(status, 'Enter a valid positive limit price (maximum 2 decimal places).', 'error'); return;
    }
    const limitPricePaise = Math.round(price * 100);
    if (!Number.isSafeInteger(limitPricePaise) || limitPricePaise < 1) {
      showMessage(status, 'Enter a valid limit price.', 'error'); return;
    }
    const fingerprint = JSON.stringify({instrument_key:instrument.instrumentKey,side,quantity,limit_price_paise:limitPricePaise});
    let pending = readPendingLimit(uid);
    if (pending && pending.fingerprint !== fingerprint) {
      showMessage(status, translate('A previous LIMIT order response is uncertain. Retry with the same stock, side, quantity and price before changing the ticket.'), 'warning');
      return;
    }
    if (!pending) {
      if (!window.crypto?.randomUUID) {
        showMessage(status, 'Secure order request ID unavailable in this browser. No order was sent.', 'error'); return;
      }
      pending = {key:window.crypto.randomUUID(),fingerprint};
      if (!savePendingLimit(uid,pending)) {
        showMessage(status, 'Session storage unavailable. No LIMIT order was sent because safe retry protection could not be saved.', 'error'); return;
      }
    }
    limitSubmitting = true;
    [buy,sell].forEach(button => button.setAttribute('aria-busy','true'));
    showMessage(status, 'Submitting LIMIT order and reserving virtual funds/shares…', 'loading');
    try {
      const headers = await authHeaders();
      const response = await fetch(gateway + '/paper/orders', {
        method:'POST',
        headers:{...headers,'Content-Type':'application/json'},
        body:JSON.stringify({instrument_key:instrument.instrumentKey,side,quantity,order_type:'LIMIT',limit_price_paise:limitPricePaise,idempotency_key:pending.key})
      });
      const data = await response.json().catch(() => ({}));
      if (connector.getUserId() !== uid) throw new Error('Account changed while the order was processing. Sign in again to verify its result.');
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) clearPendingLimit(uid);
        throw new Error(data.error || 'LIMIT order could not be submitted.');
      }
      if (data.status !== 'PENDING' || data.orderType !== 'LIMIT' || typeof data.orderId !== 'string') {
        throw new Error('LIMIT order response could not be verified. Retry the same order to safely check its result.');
      }
      clearPendingLimit(uid);
      await refreshAll();
      showMessage(status, translate('LIMIT order submitted and reservation confirmed.'), 'success');
    } catch (error) {
      showMessage(status, error.message || 'LIMIT order submission failed.', 'error');
    } finally {
      limitSubmitting = false;
      [buy,sell].forEach(button => button.removeAttribute('aria-busy'));
    }
  }
  [buy, sell].forEach((button, index) => button.addEventListener('click', event => {
    if (selectedType !== 'LIMIT') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    submitLimitOrder(index === 0 ? 'BUY' : 'SELL');
  }, true));

  function orderRow(order) {
    const tr = document.createElement('tr');
    const created = Number.isFinite(order.createdAt) ? new Date(order.createdAt) : null;
    const when = created && !Number.isNaN(created.getTime()) ? created.toLocaleString('en-IN', {dateStyle:'medium',timeStyle:'short'}) : '—';
    const execution = Number.isSafeInteger(order.executionPricePaise) ? money(order.executionPricePaise) : '—';
    const limit = Number.isSafeInteger(order.limitPricePaise) ? money(order.limitPricePaise) : '—';
    const values = [when,order.tradingSymbol,translate(String(order.side || '')),translate(String(order.orderType || 'MARKET')),order.quantity,limit,execution,translate(String(order.status || ''))];
    values.forEach(value => { const td = document.createElement('td'); td.textContent = String(value ?? '—'); tr.append(td); });
    const action = document.createElement('td');
    if (order.orderType === 'LIMIT' && order.status === 'PENDING' && typeof order.id === 'string') {
      const cancel = document.createElement('button');
      cancel.type = 'button'; cancel.className = 'paper-cancel-button'; cancel.textContent = translate('Cancel');
      cancel.addEventListener('click', () => cancelLimitOrder(order.id, cancel));
      action.append(cancel);
    } else action.textContent = '—';
    tr.append(action);
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
      td.colSpan = 9; td.textContent = translate('No orders match this filter.');
      tr.append(td); ordersBody.append(tr); return;
    }
    filtered.forEach(order => ordersBody.append(orderRow(order)));
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
      const created = Number.isFinite(order.createdAt) ? new Date(order.createdAt) : null;
      const when = created && !Number.isNaN(created.getTime()) ? created.toLocaleString('en-IN', {dateStyle:'medium',timeStyle:'short'}) : '—';
      [when,order.tradingSymbol,translate(String(order.side || '')),order.quantity,money(order.executionPricePaise),translate(String(order.orderType || 'MARKET'))].forEach(value => {
        const td = document.createElement('td'); td.textContent = String(value ?? '—'); tr.append(td);
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
    const connector = window.ZENURA_MARKET_CONNECTOR, uid = connector?.getUserId?.(), seq = ++balanceRequest;
    if (!uid || !gateway) return;
    showMessage(ordersStatus, translate('Loading balances…'), 'loading');
    try {
      const headers = await authHeaders();
      const response = await fetch(gateway + '/paper/account', {headers});
      const account = await response.json();
      if (seq !== balanceRequest || connector.getUserId() !== uid) return;
      if (!response.ok) throw new Error(account.error || 'Account balance unavailable.');
      const reservedCash = Number.isSafeInteger(account.reservedCashPaise) ? account.reservedCashPaise : 0;
      const reservedMargin = Number.isSafeInteger(account.reservedMarginPaise) ? account.reservedMarginPaise : 0;
      if (!Number.isSafeInteger(account.cashPaise) || account.cashPaise < reservedCash + reservedMargin) throw new Error('Account cash reservation data is invalid.');
      cashAvailable.textContent = money(account.cashPaise - reservedCash - reservedMargin);
      cashReserved.textContent = money(reservedCash) + (reservedMargin ? ' + ' + money(reservedMargin) + ' margin' : '');
      const positions = account.positions && typeof account.positions === 'object' ? account.positions : {};
      const reservations = account.reservedPositions && typeof account.reservedPositions === 'object' ? account.reservedPositions : {};
      let held = 0, reserved = 0;
      for (const [key, position] of Object.entries(positions)) {
        const quantity = Number.isSafeInteger(position?.quantity) ? position.quantity : 0;
        const reservedQuantity = Number.isSafeInteger(reservations[key]) ? reservations[key] : 0;
        if (reservedQuantity > quantity) throw new Error('Share reservation data is invalid.');
        held += quantity; reserved += reservedQuantity;
      }
      sharesAvailable.textContent = (held - reserved).toLocaleString('en-IN');
      sharesReserved.textContent = reserved.toLocaleString('en-IN');
      showMessage(ordersStatus, 'Balances and reservations refreshed from your private paper account.', 'success');
    } catch (error) {
      if (seq !== balanceRequest || connector.getUserId() !== uid) return;
      [cashAvailable,cashReserved,sharesAvailable,sharesReserved].forEach(el => { el.textContent = '—'; });
      showMessage(ordersStatus, error.message || 'Could not load balances.', 'error');
    }
  }
  async function loadOrders({append = false} = {}) {
    const connector = window.ZENURA_MARKET_CONNECTOR, uid = connector?.getUserId?.(), seq = ++requestSeq;
    if (!uid || !gateway) {
      currentOrders = []; nextCursor = null; hasMore = false;
      showMessage(ordersStatus, translate('Sign in to view private orders.'), 'warning');
      renderOrders(); renderTrades(); return;
    }
    showMessage(ordersStatus, translate('Loading orders from your private paper account…'), 'loading');
    try {
      const headers = await authHeaders();
      const params = new URLSearchParams({limit:'100'});
      if (append && nextCursor) params.set('cursor', nextCursor);
      const response = await fetch(gateway + '/paper/orders?' + params.toString(), {headers});
      const data = await response.json();
      if (seq !== requestSeq || connector.getUserId() !== uid) return;
      if (!response.ok) throw new Error(data.error || 'Order history unavailable.');
      const incoming = Array.isArray(data.orders) ? data.orders : [];
      currentOrders = append ? currentOrders.concat(incoming) : incoming;
      nextCursor = data.nextCursor || null; hasMore = !!data.hasMore && !!nextCursor;
      if (loadMore) loadMore.hidden = !hasMore;
      showMessage(ordersStatus, currentOrders.length ? currentOrders.length + ' orders loaded from backend.' : translate('No paper orders recorded yet.'), 'success');
      showMessage(tradeStatus, 'Trade history includes only backend orders with FILLED status.', 'info');
      renderOrders(); renderTrades();
    } catch (error) {
      if (seq !== requestSeq || connector.getUserId() !== uid) return;
      showMessage(ordersStatus, error.message || 'Could not load orders.', 'error');
      if (!append) { currentOrders = []; renderOrders(); renderTrades(); }
    }
  }
  async function cancelLimitOrder(orderId, button) {
    const connector = window.ZENURA_MARKET_CONNECTOR, uid = connector?.getUserId?.();
    if (!uid || !gateway || button.disabled) return;
    button.disabled = true;
    button.textContent = language === 'hi' ? 'रद्द हो रहा है…' : 'CANCELLING…';
    try {
      const headers = await authHeaders();
      const response = await fetch(gateway + '/paper/orders/' + encodeURIComponent(orderId) + '/cancel', {method:'POST',headers});
      const data = await response.json().catch(() => ({}));
      if (connector.getUserId() !== uid) return;
      if (!response.ok) throw new Error(data.error || 'Pending LIMIT order could not be cancelled.');
      if (data.status !== 'CANCELLED' || data.reservationReleased !== true && data.idempotentReplay !== true) {
        throw new Error('Cancellation response could not be verified. Refresh order history before retrying.');
      }
      await refreshAll();
      showMessage(ordersStatus, translate('Order cancelled and reservation released.'), 'success');
    } catch (error) {
      button.disabled = false;
      button.textContent = translate('Cancel');
      showMessage(ordersStatus, error.message || 'Order cancellation failed.', 'error');
    }
  }
  async function refreshAll() { await Promise.all([loadBalances(), loadOrders()]); }
  refresh?.addEventListener('click', refreshAll);
  loadMore?.addEventListener('click', () => loadOrders({append:true}));
  window.addEventListener('zenura-market-auth-ready', event => {
    if (!event.detail?.signedIn) {
      requestSeq++; balanceRequest++; currentOrders = []; nextCursor = null; hasMore = false;
      [cashAvailable,cashReserved,sharesAvailable,sharesReserved].forEach(el => { el.textContent = '—'; });
      if (loadMore) loadMore.hidden = true;
      showMessage(ordersStatus, translate('Sign in to view private orders.'), 'warning');
      renderOrders(); renderTrades();
      return;
    }
    refreshAll();
  });
  langButton?.addEventListener('click', () => {
    language = language === 'en' ? 'hi' : 'en';
    document.querySelectorAll('[data-paper-en]').forEach(el => {
      const english = el.getAttribute('data-paper-en');
      const textNode = [...el.childNodes].find(node => node.nodeType === 3);
      if (textNode) textNode.textContent = translate(english);
      else el.insertBefore(document.createTextNode(translate(english)), el.firstChild);
    });
    typeButtons.forEach(button => { button.textContent = translate(button.dataset.orderType); });
    tabs.forEach(button => { const key = button.dataset.orderFilter === 'OPEN' ? 'OPEN / PENDING' : button.dataset.orderFilter; button.textContent = translate(key); });
    if (langButton) langButton.textContent = language === 'en' ? 'हिन्दी' : 'English';
    referencePrice.placeholder = language === 'hi' ? 'सत्यापित भाव की प्रतीक्षा' : 'Waiting for verified quote';
    limitPrice.placeholder = language === 'hi' ? 'लिमिट कीमत दर्ज करें' : 'Enter limit price';
    renderOrders(); renderTrades();
  });
  setOrderType('MARKET');
  if (window.ZENURA_MARKET_CONNECTOR?.getUserId?.()) refreshAll();
})();