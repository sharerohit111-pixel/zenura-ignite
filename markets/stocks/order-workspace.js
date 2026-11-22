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
  const productMode = $('paper-product-mode');
  const selectedProduct = () => productMode?.value === 'INTRADAY' ? 'INTRADAY' : 'DELIVERY';
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
    'VIRTUAL CASH':'वर्चुअल नकद','REALIZED P&L':'वास्तविक P&L','DATE & TIME':'तारीख और समय','STOCK':'शेयर','SIDE':'प्रकार','TYPE':'ऑर्डर प्रकार','QTY':'मात्रा','EXECUTION PRICE':'एक्जीक्यूशन कीमत','CHARGES':'शुल्क','ACTION':'कार्रवाई','Limit Price':'लिमिट कीमत','Order':'ऑर्डर','Status':'स्थिति',
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
    'No filled trades recorded yet.':'अभी तक कोई पूरा हुआ ट्रेड दर्ज नहीं है।',
    'Sign in to view private orders.':'निजी ऑर्डर देखने के लिए साइन इन करें।',
    'Select a verified NSE/BSE cash equity first.':'पहले सत्यापित NSE/BSE कैश इक्विटी चुनें।',
    'LIMIT orders are sent to your private paper account and reserve virtual cash or shares.':'LIMIT ऑर्डर आपके निजी पेपर अकाउंट में भेजे जाते हैं और वर्चुअल नकद या शेयर आरक्षित करते हैं।',
    'LIMIT order submitted and reservation confirmed.':'LIMIT ऑर्डर जमा हुआ और आरक्षण की पुष्टि हुई।',
    'Order cancelled and reservation released.':'ऑर्डर रद्द हुआ और आरक्षण मुक्त हुआ।',
    'A previous LIMIT order response is uncertain. Retry with the same stock, side, quantity and price before changing the ticket.':'पिछले LIMIT ऑर्डर का जवाब स्पष्ट नहीं है। टिकट बदलने से पहले उसी शेयर, प्रकार, मात्रा और कीमत के साथ दोबारा प्रयास करें।',
    'Cancellation is available only for pending LIMIT orders.':'रद्द करने की सुविधा केवल पेंडिंग LIMIT ऑर्डर के लिए उपलब्ध है।',
    'Loading orders from your private paper account…':'आपके निजी पेपर अकाउंट से ऑर्डर लोड हो रहे हैं…',
    'No paper orders recorded yet.':'अभी कोई पेपर ऑर्डर दर्ज नहीं है।',
    'Loading balances…':'बैलेंस लोड हो रहा है…','Balances and reservations refreshed from your private paper account.':'आपके निजी पेपर अकाउंट का बैलेंस और आरक्षण अपडेट हुआ।','Trade history includes only backend orders with FILLED status.':'ट्रेड हिस्ट्री में केवल बैकएंड के FILLED ऑर्डर शामिल हैं।','Loading older orders…':'पुराने ऑर्डर लोड हो रहे हैं…','orders loaded from backend.':'ऑर्डर बैकएंड से लोड हुए।',
    'MARKET orders use the existing server-verified Upstox quote flow. Displayed price is indicative only.':'MARKET ऑर्डर मौजूदा सत्यापित Upstox भाव प्रक्रिया से चलते हैं। दिखाया गया भाव केवल संकेतात्मक है।',
    'Enter a whole-number quantity between 1 and 1,000,000.':'1 से 1,000,000 के बीच पूर्ण संख्या में मात्रा दर्ज करें।',
    'Enter a valid positive limit price (maximum 2 decimal places).':'सही धनात्मक लिमिट कीमत दर्ज करें (अधिकतम 2 दशमलव स्थान)।',
    'Enter a valid limit price.':'सही लिमिट कीमत दर्ज करें।',
    'Saved LIMIT retry data is unreadable. No order was sent; resolve browser storage before placing another LIMIT order.':'सहेजा गया LIMIT retry डेटा पढ़ा नहीं जा सका। कोई ऑर्डर नहीं भेजा गया; नया LIMIT ऑर्डर देने से पहले ब्राउज़र स्टोरेज ठीक करें।',
    'Secure order request ID unavailable in this browser. No order was sent.':'इस ब्राउज़र में सुरक्षित ऑर्डर अनुरोध ID उपलब्ध नहीं है। कोई ऑर्डर नहीं भेजा गया।',
    'Browser storage unavailable. No LIMIT order was sent because safe retry protection could not be saved.':'ब्राउज़र स्टोरेज उपलब्ध नहीं है। सुरक्षित retry सुरक्षा सहेजी नहीं जा सकी, इसलिए LIMIT ऑर्डर नहीं भेजा गया।',
    'Submitting LIMIT order and reserving virtual funds/shares…':'LIMIT ऑर्डर भेजा जा रहा है और वर्चुअल नकद/शेयर आरक्षित किए जा रहे हैं…',
    'Account changed while the order was processing. Sign in again to verify its result.':'ऑर्डर प्रक्रिया के दौरान अकाउंट बदल गया। परिणाम की पुष्टि के लिए दोबारा साइन इन करें।',
    'LIMIT order could not be submitted.':'LIMIT ऑर्डर जमा नहीं हो सका।',
    'LIMIT order response could not be verified. Retry the same order to safely check its result.':'LIMIT ऑर्डर के जवाब की पुष्टि नहीं हो सकी। परिणाम सुरक्षित रूप से जाँचने के लिए उसी ऑर्डर को दोबारा भेजें।',
    'LIMIT order was already filled; execution is recorded in Trade History.':'LIMIT ऑर्डर पहले ही पूरा हो चुका है; निष्पादन Trade History में दर्ज है।',
    'LIMIT order was already cancelled; no active reservation remains.':'LIMIT ऑर्डर पहले ही रद्द हो चुका है; अब कोई सक्रिय आरक्षण नहीं है।',
    'LIMIT order submission failed.':'LIMIT ऑर्डर जमा करने में विफलता हुई।',
    'CANCELLING…':'रद्द किया जा रहा है…',
    'Pending LIMIT order could not be cancelled.':'पेंडिंग LIMIT ऑर्डर रद्द नहीं हो सका।',
    'Cancellation response could not be verified. Refresh order history before retrying.':'रद्द करने के जवाब की पुष्टि नहीं हो सकी। दोबारा प्रयास से पहले ऑर्डर हिस्ट्री रीफ्रेश करें।',
    'Order cancellation failed.':'ऑर्डर रद्द करने में विफलता हुई।',
    'Account balance unavailable.':'अकाउंट बैलेंस उपलब्ध नहीं है।',
    'Account cash reservation data is invalid.':'अकाउंट के नकद आरक्षण का डेटा अमान्य है।',
    'Share reservation data is invalid.':'शेयर आरक्षण का डेटा अमान्य है।',
    'Order history unavailable.':'ऑर्डर हिस्ट्री उपलब्ध नहीं है।',
    'Could not load orders.':'ऑर्डर लोड नहीं हो सके।',
    'Could not load balances.':'बैलेंस लोड नहीं हो सका।'
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
    if (type === 'LIMIT' && selectedProduct() === 'INTRADAY') {
      type = 'MARKET';
      showMessage(status, 'Intraday LIMIT orders are not enabled yet. Choose Delivery for LIMIT orders.', 'warning');
    }
    selectedType = type;
    const limitButton = typeButtons.find(button => button.dataset.orderType === 'LIMIT');
    if (limitButton) limitButton.disabled = selectedProduct() === 'INTRADAY';
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
      status.textContent = translate('MARKET orders use the existing server-verified Upstox quote flow. Displayed price is indicative only.');
    }
    updateEstimate();
  }
  typeButtons.forEach(button => button.addEventListener('click', () => setOrderType(button.dataset.orderType)));
  productMode?.addEventListener('change', () => { if (selectedProduct() === 'INTRADAY' && selectedType === 'LIMIT') setOrderType('MARKET'); else setOrderType(selectedType); refreshAll(); });
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
      const raw = localStorage.getItem(limitStorageKey(uid));
      if (!raw) return null;
      const pending = JSON.parse(raw);
      if (!pending || typeof pending !== 'object' ||
          typeof pending.fingerprint !== 'string' ||
          typeof pending.key !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pending.key)) {
        return {storageError:true};
      }
      return pending;
    } catch (_) { return {storageError:true}; }
  }
  function savePendingLimit(uid, pending) {
    try { localStorage.setItem(limitStorageKey(uid), JSON.stringify(pending)); return true; }
    catch (_) { return false; }
  }
  function clearPendingLimit(uid) {
    try { localStorage.removeItem(limitStorageKey(uid)); } catch (_) {}
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
      showMessage(status, translate('Enter a whole-number quantity between 1 and 1,000,000.'), 'error'); return;
    }
    if (!Number.isFinite(price) || price <= 0 || price > 99999999 || !/^\d{1,8}(?:\.\d{1,2})?$/.test(limitPrice.value.trim())) {
      showMessage(status, translate('Enter a valid positive limit price (maximum 2 decimal places).'), 'error'); return;
    }
    const limitPricePaise = Math.round(price * 100);
    if (!Number.isSafeInteger(limitPricePaise) || limitPricePaise < 1) {
      showMessage(status, translate('Enter a valid limit price.'), 'error'); return;
    }
    const product = selectedProduct();
    const fingerprintPayload = {instrument_key:instrument.instrumentKey,side,quantity,limit_price_paise:limitPricePaise};
    if (product === 'INTRADAY') fingerprintPayload.product = product;
    const fingerprint = JSON.stringify(fingerprintPayload);
    let pending = readPendingLimit(uid);
    if (pending?.storageError) {
      showMessage(status, translate('Saved LIMIT retry data is unreadable. No order was sent; resolve browser storage before placing another LIMIT order.'), 'error');
      return;
    }
    if (pending && pending.fingerprint !== fingerprint) {
      showMessage(status, translate('A previous LIMIT order response is uncertain. Retry with the same stock, side, quantity and price before changing the ticket.'), 'warning');
      return;
    }
    if (!pending) {
      if (!window.crypto?.randomUUID) {
        showMessage(status, translate('Secure order request ID unavailable in this browser. No order was sent.'), 'error'); return;
      }
      pending = {key:window.crypto.randomUUID(),fingerprint};
      if (!savePendingLimit(uid,pending)) {
        showMessage(status, translate('Browser storage unavailable. No LIMIT order was sent because safe retry protection could not be saved.'), 'error'); return;
      }
    }
    limitSubmitting = true;
    [buy,sell].forEach(button => button.setAttribute('aria-busy','true'));
    showMessage(status, translate('Submitting LIMIT order and reserving virtual funds/shares…'), 'loading');
    try {
      const headers = await authHeaders();
      if (connector.getUserId() !== uid) throw new Error(translate('Account changed while the order was processing. Sign in again to verify its result.'));
      const response = await fetch(gateway + '/paper/orders', {
        method:'POST',
        headers:{...headers,'Content-Type':'application/json'},
        body:JSON.stringify({instrument_key:instrument.instrumentKey,side,quantity,product,order_type:'LIMIT',limit_price_paise:limitPricePaise,idempotency_key:pending.key})
      });
      const data = await response.json().catch(() => ({}));
      if (connector.getUserId() !== uid) throw new Error(translate('Account changed while the order was processing. Sign in again to verify its result.'));
      if (!response.ok) {
        // Keep the idempotency key for timeout, conflict, rate-limit and server errors:
        // the server may already have accepted the order even when the response is uncertain.
        if ([400,401,403,404,422].includes(response.status)) clearPendingLimit(uid);
        throw new Error(data.error || translate('LIMIT order could not be submitted.'));
      }
      if (!['PENDING','FILLED','CANCELLED'].includes(data.status) || data.orderType !== 'LIMIT' || typeof data.orderId !== 'string') {
        throw new Error(translate('LIMIT order response could not be verified. Retry the same order to safely check its result.'));
      }
      clearPendingLimit(uid);
      await refreshAll();
      const resultMessage = data.status === 'PENDING'
        ? 'LIMIT order submitted and reservation confirmed.'
        : data.status === 'FILLED'
          ? translate('LIMIT order was already filled; execution is recorded in Trade History.')
          : translate('LIMIT order was already cancelled; no active reservation remains.');
      showMessage(status, translate(resultMessage), 'success');
    } catch (error) {
      if (connector.getUserId() !== uid) return;
      showMessage(status, error.message || translate('LIMIT order submission failed.'), 'error');
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
    const charges = order.chargesBreakdown?.schedule_version ? money(order.chargesPaise) : '—';
    const realized = Number.isSafeInteger(order.realizedPnlPaise) ? money(order.realizedPnlPaise) : '—';
    const values = [when,order.tradingSymbol,order.product === 'INTRADAY' ? 'INTRADAY' : 'DELIVERY',translate(String(order.side || '')),translate(String(order.orderType || 'MARKET')),order.quantity,limit,execution,charges,realized,translate(String(order.status || ''))];
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
      td.colSpan = 12; td.textContent = translate('No orders match this filter.');
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
      td.colSpan = 9; td.textContent = translate('No filled trades recorded yet.');
      tr.append(td); tradeBody.append(tr); return;
    }
    filled.forEach(order => {
      const tr = document.createElement('tr');
      const created = Number.isFinite(order.createdAt) ? new Date(order.createdAt) : null;
      const when = created && !Number.isNaN(created.getTime()) ? created.toLocaleString('en-IN', {dateStyle:'medium',timeStyle:'short'}) : '—';
      [when,order.tradingSymbol,order.product === 'INTRADAY' ? 'INTRADAY' : 'DELIVERY',translate(String(order.side || '')),order.quantity,money(order.executionPricePaise),order.chargesBreakdown?.schedule_version ? money(order.chargesPaise) : '—',Number.isSafeInteger(order.realizedPnlPaise) ? money(order.realizedPnlPaise) : '—',translate(String(order.orderType || 'MARKET'))].forEach(value => {
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
    if (!uid || !gateway) {
      [cashAvailable,cashReserved,sharesAvailable,sharesReserved].forEach(el => { if (el) el.textContent = '—'; });
      showMessage(ordersStatus, !uid ? translate('Sign in to view private orders.') : translate('Market gateway is not configured.'), 'warning');
      return;
    }
    showMessage(ordersStatus, translate('Loading balances…'), 'loading');
    try {
      const headers = await authHeaders();
      if (seq !== balanceRequest || connector.getUserId() !== uid) return;
      const response = await fetch(gateway + '/paper/account', {headers});
      const account = await response.json();
      if (seq !== balanceRequest || connector.getUserId() !== uid) return;
      if (!response.ok) throw new Error(account.error || translate('Account balance unavailable.'));
      const reservedCash = Number.isSafeInteger(account.reservedCashPaise) ? account.reservedCashPaise : 0;
      const reservedMargin = Number.isSafeInteger(account.reservedMarginPaise) ? account.reservedMarginPaise : 0;
      if (!Number.isSafeInteger(account.cashPaise) || account.cashPaise < reservedCash + reservedMargin) throw new Error(translate('Account cash reservation data is invalid.'));
      cashAvailable.textContent = money(account.cashPaise - reservedCash - reservedMargin);
      cashReserved.textContent = money(reservedCash) + (reservedMargin ? ' + ' + money(reservedMargin) + ' margin' : '');
      const positions = (selectedProduct() === 'INTRADAY' ? account.intradayPositions : account.positions) && typeof (selectedProduct() === 'INTRADAY' ? account.intradayPositions : account.positions) === 'object' ? (selectedProduct() === 'INTRADAY' ? account.intradayPositions : account.positions) : {};
      const reservations = (selectedProduct() === 'INTRADAY' ? account.intradayReservedPositions : account.reservedPositions) && typeof (selectedProduct() === 'INTRADAY' ? account.intradayReservedPositions : account.reservedPositions) === 'object' ? (selectedProduct() === 'INTRADAY' ? account.intradayReservedPositions : account.reservedPositions) : {};
      let held = 0, reserved = 0;
      for (const [key, position] of Object.entries(positions)) {
        const quantity = Number.isSafeInteger(position?.quantity) ? position.quantity : 0;
        const reservedQuantity = Number.isSafeInteger(reservations[key]) ? reservations[key] : 0;
        if (reservedQuantity > quantity) throw new Error(translate('Share reservation data is invalid.'));
        held += quantity; reserved += reservedQuantity;
      }
      sharesAvailable.textContent = (held - reserved).toLocaleString('en-IN');
      sharesReserved.textContent = reserved.toLocaleString('en-IN');
      showMessage(ordersStatus, 'Balances and reservations refreshed from your private paper account.', 'success');
    } catch (error) {
      if (seq !== balanceRequest || connector.getUserId() !== uid) return;
      [cashAvailable,cashReserved,sharesAvailable,sharesReserved].forEach(el => { el.textContent = '—'; });
      showMessage(ordersStatus, error.message || translate('Could not load balances.'), 'error');
    }
  }
  async function loadOrders({append = false} = {}) {
    const connector = window.ZENURA_MARKET_CONNECTOR, uid = connector?.getUserId?.(), seq = ++requestSeq;
    const cursor = append ? nextCursor : null;
    if (!uid || !gateway) {
      currentOrders = []; nextCursor = null; hasMore = false;
      showMessage(ordersStatus, translate('Sign in to view private orders.'), 'warning');
      renderOrders(); renderTrades(); return;
    }
    showMessage(ordersStatus, translate('Loading orders from your private paper account…'), 'loading');
    try {
      const headers = await authHeaders();
      if (seq !== requestSeq || connector.getUserId() !== uid) return;
      const params = new URLSearchParams({limit:'100'});
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(gateway + '/paper/orders?' + params.toString(), {headers});
      const data = await response.json();
      if (seq !== requestSeq || connector.getUserId() !== uid) return;
      if (!response.ok) throw new Error(data.error || translate('Order history unavailable.'));
      const incoming = Array.isArray(data.orders) ? data.orders : [];
      currentOrders = append ? currentOrders.concat(incoming) : incoming;
      nextCursor = data.nextCursor || null; hasMore = !!data.hasMore && !!nextCursor;
      if (loadMore) loadMore.hidden = !hasMore;
      showMessage(ordersStatus, currentOrders.length ? currentOrders.length + ' orders loaded from backend.' : translate('No paper orders recorded yet.'), 'success');
      showMessage(tradeStatus, 'Trade history includes only backend orders with FILLED status.', 'info');
      renderOrders(); renderTrades();
    } catch (error) {
      if (seq !== requestSeq || connector.getUserId() !== uid) return;
      showMessage(ordersStatus, error.message || translate('Could not load orders.'), 'error');
      if (!append) { currentOrders = []; renderOrders(); renderTrades(); }
    }
  }
  async function cancelLimitOrder(orderId, button) {
    const connector = window.ZENURA_MARKET_CONNECTOR, uid = connector?.getUserId?.();
    if (!uid || !gateway || button.disabled) return;
    button.disabled = true;
    button.textContent = translate('CANCELLING…');
    try {
      const headers = await authHeaders();
      if (connector.getUserId() !== uid) throw new Error(translate('Account changed while the order was processing. Sign in again to verify its result.'));
      const response = await fetch(gateway + '/paper/orders/' + encodeURIComponent(orderId) + '/cancel', {method:'POST',headers});
      const data = await response.json().catch(() => ({}));
      if (connector.getUserId() !== uid) return;
      if (!response.ok) throw new Error(data.error || translate('Pending LIMIT order could not be cancelled.'));
      if (data.orderId !== orderId || data.status !== 'CANCELLED' || data.reservationReleased !== true && data.idempotentReplay !== true) {
        throw new Error(translate('Cancellation response could not be verified. Refresh order history before retrying.'));
      }
      await refreshAll();
      showMessage(ordersStatus, translate('Order cancelled and reservation released.'), 'success');
    } catch (error) {
      if (connector.getUserId() !== uid) return;
      button.disabled = false;
      button.textContent = translate('Cancel');
      showMessage(ordersStatus, error.message || translate('Order cancellation failed.'), 'error');
    }
  }
  async function refreshAll() { await Promise.all([loadBalances(), loadOrders()]); }
  refresh?.addEventListener('click', refreshAll);
  loadMore?.addEventListener('click', () => loadOrders({append:true}));
  window.addEventListener('zenura-market-auth-ready', event => {
    // Every auth transition may represent a different account. Invalidate in-flight
    // requests and clear the previous account's private data before loading the next.
    requestSeq++; balanceRequest++;
    currentOrders = []; nextCursor = null; hasMore = false;
    [cashAvailable,cashReserved,sharesAvailable,sharesReserved].forEach(el => { el.textContent = '—'; });
    if (loadMore) loadMore.hidden = true;
    renderOrders(); renderTrades();
    if (!event.detail?.signedIn) {
      showMessage(ordersStatus, translate('Sign in to view private orders.'), 'warning');
      return;
    }
    showMessage(ordersStatus, translate('Loading account orders…'), 'info');
    refreshAll();
  });
  langButton?.addEventListener('click', () => {
    language = language === 'en' ? 'hi' : 'en';
    document.documentElement.lang = language;
    document.querySelectorAll('[data-paper-en]').forEach(el => {
      const english = el.getAttribute('data-paper-en');
      const textNode = [...el.childNodes].find(node => node.nodeType === 3);
      if (textNode) textNode.textContent = translate(english);
      else el.insertBefore(document.createTextNode(translate(english)), el.firstChild);
    });
    typeButtons.forEach(button => { button.textContent = translate(button.dataset.orderType); });
    tabs.forEach(button => { const key = button.dataset.orderFilter === 'OPEN' ? 'OPEN / PENDING' : button.dataset.orderFilter; button.textContent = translate(key); });
    if (langButton) langButton.textContent = language === 'en' ? 'हिन्दी' : 'English';
    if (langButton) langButton.setAttribute('aria-label', language === 'hi' ? 'पेपर ट्रेडिंग की भाषा बदलें' : 'Switch Paper Trading language');
    referencePrice.placeholder = language === 'hi' ? 'सत्यापित भाव की प्रतीक्षा' : 'Waiting for verified quote';
    limitPrice.placeholder = language === 'hi' ? 'लिमिट कीमत दर्ज करें' : 'Enter limit price';
    renderOrders(); renderTrades();
  });
  setOrderType('MARKET');
  if (window.ZENURA_MARKET_CONNECTOR?.getUserId?.()) refreshAll();
})();