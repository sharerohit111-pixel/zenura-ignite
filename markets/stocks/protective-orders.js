/* ZENURA IGNITE — isolated equity protective-order UI.
 * Server-side evaluation only; the gateway decides eligibility and execution.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const gateway = (document.querySelector('meta[name="market-gateway-url"]')?.content || '').trim().replace(/\/+$/, '');
  const type = $('paper-protective-type');
  const price = $('paper-protective-price');
  const create = $('paper-protective-create');
  const status = $('paper-protective-status');
  const listStatus = $('paper-protective-list-status');
  const body = $('paper-protective-orders-body');
  const refresh = $('paper-protective-refresh');
  const product = $('paper-product-mode');
  const quantity = $('paper-quantity');
  if (!type || !price || !create || !status || !listStatus || !body || !refresh || !product || !quantity) return;

  let workerEnabled = false;
  let requestSequence = 0;
  let language = document.documentElement.lang === 'hi' ? 'hi' : 'en';
  let submitting = false;
  let cancelling = false;
  let activeUid = null;
  const messages = {
    'Sign in to load protective orders.':'प्रोटेक्टिव ऑर्डर देखने के लिए साइन इन करें।',
    'Market gateway URL is not configured.':'मार्केट गेटवे URL कॉन्फ़िगर नहीं है।',
    'Protective execution is not enabled on this gateway.':'इस गेटवे पर प्रोटेक्टिव निष्पादन सक्षम नहीं है।',
    'Loading server-evaluated protective orders…':'सर्वर द्वारा जाँचे गए प्रोटेक्टिव ऑर्डर लोड हो रहे हैं…',
    'No protective orders recorded yet.':'अभी कोई प्रोटेक्टिव ऑर्डर दर्ज नहीं है।',
    'Select a verified NSE/BSE cash equity first.':'पहले सत्यापित NSE/BSE कैश इक्विटी चुनें।',
    'Enter a whole-number quantity between 1 and 1,000,000.':'1 से 1,000,000 के बीच पूर्ण संख्या में मात्रा दर्ज करें।',
    'Enter a valid trigger price (maximum 2 decimal places).':'सही ट्रिगर कीमत दर्ज करें (अधिकतम 2 दशमलव स्थान)।',
    'Submitting server-evaluated protective exit…':'सर्वर-जाँचा जाने वाला प्रोटेक्टिव ऑर्डर भेजा जा रहा है…',
    'Protective exit created. The server worker evaluates fresh provider quotes.':'प्रोटेक्टिव ऑर्डर बन गया। सर्वर वर्कर ताज़ा प्रदाता भाव जाँचेगा।',
    'A previous protective-order response is uncertain. Retry the same stock, rule, quantity and price before changing the ticket.':'पिछले प्रोटेक्टिव ऑर्डर का जवाब स्पष्ट नहीं है। टिकट बदलने से पहले उसी शेयर, नियम, मात्रा और कीमत के साथ दोबारा प्रयास करें।',
    'Saved protective retry data is unreadable. No request was sent.':'सहेजा गया retry डेटा पढ़ा नहीं जा सका। कोई अनुरोध नहीं भेजा गया।',
    'Protective order could not be created.':'प्रोटेक्टिव ऑर्डर नहीं बन सका।',
    'Cancel':'रद्द करें',
    'Modify':'बदलें','Save':'सहेजें','Saving…':'सहेजा जा रहा है…','Close':'बंद करें',
    'Protective order modified.':'प्रोटेक्टिव ऑर्डर बदल दिया गया।','Protective order modification failed.':'प्रोटेक्टिव ऑर्डर में बदलाव नहीं हो सका।',
    'Enter a valid trigger price and whole-number quantity.':'सही ट्रिगर कीमत और पूर्ण संख्या में मात्रा दर्ज करें。',
    'CANCELLING…':'रद्द किया जा रहा है…',
    'Protective order cancelled.':'प्रोटेक्टिव ऑर्डर रद्द हो गया।',
    'Protective order cancellation failed.':'प्रोटेक्टिव ऑर्डर रद्द नहीं हो सका।',
    'Refresh':'रीफ्रेश करें',
    'ACTIVE':'सक्रिय','FILLED':'पूरा हुआ','CANCELLED':'रद्द','REJECTED':'अस्वीकृत',
    'STOP_LOSS':'स्टॉप-लॉस','TARGET':'लक्ष्य','DELIVERY':'डिलीवरी','INTRADAY':'इंट्राडे'
  };
  const tr = value => language === 'hi' ? (messages[value] || value) : value;
  const connector = () => window.ZENURA_MARKET_CONNECTOR;
  const uid = () => connector()?.getUserId?.() || null;
  const show = (element, message, kind='info') => {
    element.textContent = tr(message);
    element.dataset.state = kind;
  };
  const setEnabled = enabled => {
    workerEnabled = enabled;
    const signedIn = !!uid();
    const canUse = signedIn && !!gateway && workerEnabled && !submitting;
    price.disabled = !canUse;
    type.disabled = !canUse;
    create.disabled = !canUse;
    if (!gateway) show(status, 'Market gateway URL is not configured.', 'warning');
    else if (!signedIn) show(status, 'Sign in to load protective orders.', 'warning');
    else if (!workerEnabled) show(status, 'Protective execution is not enabled on this gateway.', 'warning');
  };
  async function headers(expectedUid) {
    const api = connector();
    if (!gateway || !api?.getIdToken || !expectedUid) throw new Error(tr('Sign in to load protective orders.'));
    const token = await api.getIdToken();
    if (api.getUserId() !== expectedUid) throw new Error('Account changed while the request was processing.');
    return {Authorization:'Bearer '+token,Accept:'application/json','Content-Type':'application/json'};
  }
  function selectedInstrument() {
    const key = $('selected-symbol')?.textContent?.trim() || '';
    const symbol = $('selected-name')?.textContent?.trim() || '';
    if (!key.includes('|') || !symbol || /no instrument selected|choose an instrument/i.test(symbol)) return null;
    return {instrumentKey:key,tradingSymbol:symbol};
  }
  function retryKey(userId) { return 'zenura-paper-protective-pending-v1:'+userId; }
  function readPending(userId) {
    try {
      const raw=localStorage.getItem(retryKey(userId));
      if (!raw) return null;
      const value=JSON.parse(raw);
      if (!value || typeof value.fingerprint!=='string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.orderId))
        return {storageError:true};
      return value;
    } catch (_) { return {storageError:true}; }
  }
  function savePending(userId,value) {
    try { localStorage.setItem(retryKey(userId),JSON.stringify(value)); return true; }
    catch (_) { return false; }
  }
  function clearPending(userId) {
    try { localStorage.removeItem(retryKey(userId)); } catch (_) {}
  }
  function formatMoney(paise) {
    return Number.isSafeInteger(paise) ? '₹'+(paise/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
  }
  function cell(row,value) {
    const el=document.createElement('td');
    el.textContent=String(value ?? '—');
    row.append(el);
    return el;
  }
  function render(orders) {
    body.textContent='';
    if (!orders.length) {
      const row=document.createElement('tr'),empty=cell(row,tr('No protective orders recorded yet.'));
      empty.colSpan=8;body.append(row);return;
    }
    for (const order of orders) {
      const row=document.createElement('tr');
      cell(row,order.createdAt ? new Date(order.createdAt).toLocaleString('en-IN') : '—');
      cell(row,order.tradingSymbol || order.instrumentKey);
      cell(row,tr(order.product));
      cell(row,tr(order.triggerType));
      cell(row,order.quantity);
      cell(row,formatMoney(order.triggerPricePaise));
      cell(row,tr(order.status));
      const action=cell(row,'');
      if (order.status==='ACTIVE') {
        const modify=document.createElement('button');
        modify.type='button';modify.textContent=tr('Modify');
        modify.addEventListener('click',()=>beginEdit(order,action));
        action.append(modify);
        const button=document.createElement('button');
        button.type='button';button.textContent=tr('Cancel');
        button.addEventListener('click',()=>cancelOrder(order.orderId,button));
        action.append(button);
      } else action.textContent='—';
      body.append(row);
    }
  }
  async function loadOrders() {
    const request=++requestSequence,userId=uid();
    activeUid=userId;
    if (!gateway) { setEnabled(false);show(listStatus,'Market gateway URL is not configured.','warning');render([]);return; }
    if (!userId) { setEnabled(false);show(listStatus,'Sign in to load protective orders.','warning');render([]);return; }
    show(listStatus,'Loading server-evaluated protective orders…');
    try {
      const response=await fetch(gateway+'/paper/protective-orders?limit=50',{headers:await headers(userId)});
      const data=await response.json();
      if (request!==requestSequence || uid()!==userId) return;
      if (!response.ok) throw new Error(data.error || 'Protective orders could not be loaded.');
      setEnabled(data.workerEnabled===true);
      render(Array.isArray(data.orders)?data.orders:[]);
      show(listStatus,data.orders?.length ? data.orders.length+' protective orders loaded.':'No protective orders recorded yet.','success');
    } catch(error) {
      if (request!==requestSequence || uid()!==userId) return;
      setEnabled(false);
      show(listStatus,error.message || 'Protective orders could not be loaded.','error');
    }
  }
  function beginEdit(order,actionCell) {
    if (actionCell.querySelector('.protective-edit-form')) return;
    const form=document.createElement('form');
    form.className='protective-edit-form';
    const rule=document.createElement('select');
    rule.setAttribute('aria-label','Protective rule');
    for (const [value,label] of [['STOP_LOSS','STOP_LOSS'],['TARGET','TARGET']]) {
      const option=document.createElement('option');option.value=value;option.textContent=tr(label);rule.append(option);
    }
    rule.value=order.triggerType;
    const trigger=document.createElement('input');
    trigger.type='number';trigger.min='0.01';trigger.max='99999999';trigger.step='0.01';
    trigger.inputMode='decimal';trigger.value=(order.triggerPricePaise/100).toFixed(2);
    trigger.setAttribute('aria-label','Trigger price in rupees');
    const qty=document.createElement('input');
    qty.type='number';qty.min='1';qty.max='1000000';qty.step='1';
    qty.inputMode='numeric';qty.value=String(order.quantity);qty.setAttribute('aria-label','Quantity');
    const save=document.createElement('button');
    save.type='submit';save.textContent=tr('Save');
    const close=document.createElement('button');
    close.type='button';close.textContent=tr('Close');
    close.addEventListener('click',()=>form.remove());
    form.append(rule,trigger,qty,save,close);
    actionCell.append(form);
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const userId=uid(),priceValue=trigger.value.trim(),priceNumber=Number(priceValue),quantityValue=Number(qty.value);
      if (!userId||!gateway) { show(status,'Sign in to load protective orders.','warning');return; }
      if (!Number.isSafeInteger(quantityValue)||quantityValue<1||quantityValue>1000000
          ||!Number.isFinite(priceNumber)||priceNumber<=0||priceNumber>99999999
          ||!/^\\d{1,8}(?:\\.\\d{1,2})?$/.test(priceValue)) {
        show(status,'Enter a valid trigger price and whole-number quantity.','error');return;
      }
      const triggerPricePaise=Math.round(priceNumber*100);
      if (!Number.isSafeInteger(triggerPricePaise)||triggerPricePaise<1) {
        show(status,'Enter a valid trigger price and whole-number quantity.','error');return;
      }
      save.disabled=true;save.textContent=tr('Saving…');
      try {
        const response=await fetch(gateway+'/paper/protective-orders/'+encodeURIComponent(order.orderId),{
          method:'PUT',headers:await headers(userId),
          body:JSON.stringify({trigger_type:rule.value,trigger_price_paise:triggerPricePaise,quantity:quantityValue})
        });
        const data=await response.json();
        if (uid()!==userId) return;
        if (!response.ok) throw new Error(data.error||'Protective order modification failed.');
        show(status,'Protective order modified.','success');
        await loadOrders();
      } catch(error) {
        if (uid()===userId) show(status,error.message||'Protective order modification failed.','error');
      } finally {
        save.disabled=false;save.textContent=tr('Save');
      }
    });
  }
  async function createOrder() {
    if (submitting || !workerEnabled) return;
    const userId=uid(),instrument=selectedInstrument();
    if (!userId || !gateway) { show(status,'Sign in to load protective orders.','warning');return; }
    if (!instrument) { show(status,'Select a verified NSE/BSE cash equity first.','warning');return; }
    const qty=Number(quantity.value),priceValue=price.value.trim(),priceNumber=Number(priceValue);
    if (!Number.isSafeInteger(qty)||qty<1||qty>1000000) { show(status,'Enter a whole-number quantity between 1 and 1,000,000.','error');return; }
    if (!Number.isFinite(priceNumber)||priceNumber<=0||priceNumber>99999999||! /^\d{1,8}(?:\.\d{1,2})?$/.test(priceValue)) {
      show(status,'Enter a valid trigger price (maximum 2 decimal places).','error');return;
    }
    const triggerPricePaise=Math.round(priceNumber*100);
    if (!Number.isSafeInteger(triggerPricePaise)||triggerPricePaise<1) { show(status,'Enter a valid trigger price (maximum 2 decimal places).','error');return; }
    const payload={instrument_key:instrument.instrumentKey,product:product.value==='INTRADAY'?'INTRADAY':'DELIVERY',
      trigger_type:type.value,trigger_price_paise:triggerPricePaise,quantity:qty};
    const fingerprint=JSON.stringify(payload);
    let pending=readPending(userId);
    if (pending?.storageError) { show(status,'Saved protective retry data is unreadable. No request was sent.','error');return; }
    if (pending && pending.fingerprint!==fingerprint) {
      show(status,'A previous protective-order response is uncertain. Retry the same stock, rule, quantity and price before changing the ticket.','warning');return;
    }
    if (!pending) {
      if (!window.crypto?.randomUUID) { show(status,'Protective order could not be created.','error');return; }
      pending={fingerprint,orderId:window.crypto.randomUUID()};
      if (!savePending(userId,pending)) { show(status,'Saved protective retry data is unreadable. No request was sent.','error');return; }
    }
    submitting=true;create.disabled=true;price.disabled=true;type.disabled=true;
    show(status,'Submitting server-evaluated protective exit…');
    try {
      const response=await fetch(gateway+'/paper/protective-orders',{method:'POST',headers:await headers(userId),
        body:JSON.stringify({order_id:pending.orderId,...payload})});
      const data=await response.json();
      if (connector()?.getUserId?.()!==userId) return;
      if (!response.ok) {
        if (response.status>=400 && response.status<500) clearPending(userId);
        throw new Error(data.error || 'Protective order could not be created.');
      }
      clearPending(userId);
      price.value='';
      show(status,'Protective exit created. The server worker evaluates fresh provider quotes.','success');
      await loadOrders();
    } catch(error) {
      if (connector()?.getUserId?.()===userId) show(status,error.message || 'Protective order could not be created.','error');
    } finally {
      submitting=false;
      if (uid()===userId) setEnabled(workerEnabled);
    }
  }
  async function cancelOrder(orderId,button) {
    if (cancelling) return;
    const userId=uid();
    if (!userId || !gateway) return;
    cancelling=true;button.disabled=true;button.textContent=tr('CANCELLING…');
    try {
      const response=await fetch(gateway+'/paper/protective-orders/'+encodeURIComponent(orderId)+'/cancel',
        {method:'POST',headers:await headers(userId),body:'{}'});
      const data=await response.json();
      if (uid()!==userId) return;
      if (!response.ok) throw new Error(data.error || 'Protective order cancellation failed.');
      show(status,data.cancelled?'Protective order cancelled.':'Protective order cancellation failed.',data.cancelled?'success':'warning');
      await loadOrders();
    } catch(error) {
      if (uid()===userId) { button.disabled=false;button.textContent=tr('Cancel');show(status,error.message || 'Protective order cancellation failed.','error'); }
    } finally { cancelling=false; }
  }
  create.addEventListener('click',createOrder);
  refresh.addEventListener('click',loadOrders);
  window.addEventListener('zenura-market-auth-ready',event=>{
    requestSequence++;
    activeUid=event.detail?.signedIn ? uid() : null;
    workerEnabled=false;
    render([]);
    setEnabled(false);
    if (event.detail?.signedIn) loadOrders();
    else show(listStatus,'Sign in to load protective orders.','warning');
  });
  if (typeof MutationObserver!=='undefined') {
    new MutationObserver(()=>{language=document.documentElement.lang==='hi'?'hi':'en';})
      .observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  }
  if (uid()) loadOrders();
  else setEnabled(false);
})();