(function(){
  "use strict";
  const policy=window.ZenuraFuturesLimitPolicy;
  const byId=id=>document.getElementById(id);
  const gateway=(document.querySelector('meta[name="market-gateway-url"]')?.content||"").trim().replace(/\/+$/,"");
  const lotsInput=byId("futures-limit-lots"),productInput=byId("futures-limit-product");
  const priceInput=byId("futures-limit-price"),buyButton=byId("futures-limit-buy");
  const sellButton=byId("futures-limit-sell"),refreshButton=byId("futures-limit-refresh");
  const status=byId("futures-limit-status"),ordersBody=byId("futures-limit-orders");
  if(!policy||!lotsInput||!productInput||!priceInput||!buyButton||!sellButton||!status||!ordersBody)return;

  let selected=window.ZENURA_INDIAN_MARKET?.getSelectedInstrument?.()||null;
  let health=null,submitting=false,cancelling=false;
  const pendingPrefix="zenura-futures-limit-pending-v1:";

  function show(message,kind="info"){
    status.textContent=message;
    status.dataset.state=kind;
  }
  function currentUser(){
    const connector=window.ZENURA_MARKET_CONNECTOR;
    return connector?.getUserId?.()||null;
  }
  function updateTicket(){
    const supported=policy.isSupportedNseFuture(selected);
    const signedIn=!!currentUser()&&!!window.ZENURA_MARKET_CONNECTOR?.getIdToken;
    const enabled=policy.isEnabled(health);
    const canSubmit=supported&&signedIn&&enabled&&!submitting;
    buyButton.disabled=!canSubmit;
    sellButton.disabled=!canSubmit;
    if(!selected)show("Select a verified NSE Futures contract from the Futures watchlist.");
    else if(!supported)show("Futures LIMIT currently supports NSE Futures contracts only. BSE and Options LIMIT are disabled.");
    else if(!signedIn)show("Sign in and connect Upstox before submitting a Futures LIMIT order.");
    else if(!health)show("Checking the protected Futures LIMIT service status…");
    else if(!enabled)show("Futures LIMIT is safely disabled until both submit and worker feature flags are enabled after staging and compliance sign-off.");
    else show("NSE Futures LIMIT ready. Orders expire no later than the verified session close.");
  }
  async function api(path,options={}){
    const connector=window.ZENURA_MARKET_CONNECTOR,token=await connector?.getIdToken?.();
    if(!token)throw new Error("Sign in to continue.");
    if(!gateway)throw new Error("Market gateway URL is not configured.");
    const response=await fetch(gateway+path,{
      ...options,
      headers:{Authorization:"Bearer "+token,Accept:"application/json",
        ...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})},
      cache:"no-store",signal:AbortSignal.timeout(15000)
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){
      const error=new Error(payload.error||"Futures LIMIT request failed ("+response.status+").");
      error.status=response.status;error.payload=payload;throw error;
    }
    return payload;
  }
  async function loadHealth(){
    if(!gateway){health=null;updateTicket();return;}
    try{
      const response=await fetch(gateway+"/health",{cache:"no-store",signal:AbortSignal.timeout(10000)});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error("Gateway health is unavailable.");
      health=data;updateTicket();
    }catch(_){health=null;updateTicket();}
  }
  function money(paise){
    const value=Number(paise);
    if(!Number.isSafeInteger(value))return "—";
    return "₹"+(value/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
  }
  function dateText(value){
    const time=typeof value==="number"?value:Date.parse(value||"");
    return Number.isFinite(time)?new Date(time).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"}):"—";
  }
  function cell(row,value){
    const td=document.createElement("td");td.textContent=String(value??"—");row.append(td);return td;
  }
  function renderOrders(orders){
    ordersBody.textContent="";
    const limits=(Array.isArray(orders)?orders:[]).filter(order=>order.orderType==="LIMIT");
    if(!limits.length){
      const row=document.createElement("tr"),td=document.createElement("td");
      td.colSpan=10;td.textContent="No Futures LIMIT orders yet.";row.append(td);ordersBody.append(row);return;
    }
    limits.forEach(order=>{
      const row=document.createElement("tr");
      cell(row,dateText(order.createdAt));cell(row,order.tradingSymbol||order.instrumentKey);
      cell(row,order.side);cell(row,order.product);
      cell(row,Number.isSafeInteger(Number(order.quantity))&&Number.isSafeInteger(Number(order.lotSize))?Number(order.quantity)/Number(order.lotSize):"—");
      cell(row,money(order.limitPricePaise));
      cell(row,String(order.filledQuantity??0)+" / "+String(order.remainingQuantity??order.quantity));
      cell(row,order.status);cell(row,dateText(order.expiresAt));
      const action=cell(row,"");
      if(["PENDING","PARTIALLY_FILLED"].includes(order.status)){
        const button=document.createElement("button");
        button.type="button";button.className="futures-limit-cancel";
        button.textContent="CANCEL";button.dataset.orderId=order.id;
        button.disabled=cancelling;action.append(button);
      }
      ordersBody.append(row);
    });
  }
  async function loadOrders(){
    if(!currentUser()||!gateway){renderOrders([]);return;}
    try{
      const data=await api("/paper/futures/orders?limit=50");
      renderOrders(data.orders||[]);
    }catch(error){show(error.message||"Futures LIMIT history unavailable.","error");}
  }
  async function refresh(){
    await loadHealth();
    if(currentUser())await loadOrders();
    updateTicket();
  }
  function pendingStorageKey(uid){return pendingPrefix+uid;}
  function readPending(uid){
    try{
      const raw=localStorage.getItem(pendingStorageKey(uid));
      if(!raw)return null;
      const value=JSON.parse(raw);
      if(!value||typeof value!=="object"||typeof value.fingerprint!=="string"
         ||!/^[0-9a-f-]{36}$/i.test(value.key))return {storageError:true};
      return value;
    }catch(_){return {storageError:true};}
  }
  function savePending(uid,value){
    try{localStorage.setItem(pendingStorageKey(uid),JSON.stringify(value));return true;}
    catch(_){return false;}
  }
  function clearPending(uid){
    try{localStorage.removeItem(pendingStorageKey(uid));}catch(_){}
  }
  async function submit(side){
    if(submitting)return;
    const instrument=selected,uid=currentUser();
    if(!policy.isSupportedNseFuture(instrument)||!uid)return;
    const lots=Number(lotsInput.value),product=productInput.value;
    if(!policy.validLots(lots)){show("Enter whole-number lots from 1 to 10,000.","error");return;}
    const tick=policy.normalizeTickSizePaise(instrument.tick_size);
    const limitPricePaise=policy.parseLimitPricePaise(priceInput.value,tick);
    if(limitPricePaise===null){show("Enter a valid LIMIT price aligned to this contract's tick size.","error");return;}
    const fingerprint=policy.fingerprint({
      instrumentKey:instrument.instrument_key,side,lots,product,limitPricePaise
    });
    if(!fingerprint){show("Futures LIMIT ticket inputs are invalid.","error");return;}
    let pending=readPending(uid);
    if(pending?.storageError){show("Saved Futures LIMIT retry data is unreadable. No order was sent; resolve browser storage before submitting another order.","error");return;}
    if(pending&&pending.fingerprint!==fingerprint){
      show("A previous Futures LIMIT response is uncertain. Retry the exact same contract, side, lots, product and price first.","warning");return;
    }
    if(!pending){
      if(!window.crypto?.randomUUID){show("Secure order request ID is unavailable. No order was sent.","error");return;}
      pending={key:window.crypto.randomUUID(),fingerprint};
      if(!savePending(uid,pending)){show("Browser storage is unavailable. No order was sent because safe retry protection could not be saved.","error");return;}
    }
    submitting=true;buyButton.disabled=true;sellButton.disabled=true;
    [buyButton,sellButton].forEach(button=>button.setAttribute("aria-busy","true"));
    show("Submitting Futures LIMIT and reserving virtual margin or close quantity…","loading");
    try{
      const data=await api("/paper/futures/orders",{
        method:"POST",
        body:JSON.stringify({
          instrument_key:instrument.instrument_key,side,lots,product,
          order_type:"LIMIT",limit_price_paise:limitPricePaise,idempotency_key:pending.key
        })
      });
      if(currentUser()!==uid)throw new Error("Account changed while the order was processing. Sign in again to verify its result.");
      if(!data||data.orderType!=="LIMIT"||typeof data.orderId!=="string"
         ||!["PENDING","PARTIALLY_FILLED","FILLED","CANCELLED","EXPIRED","REJECTED"].includes(data.status)){
        throw new Error("Futures LIMIT response could not be verified. Retry the same order to safely check its result.");
      }
      clearPending(uid);
      show(data.status==="PENDING"?"LIMIT order submitted. Virtual reservation confirmed; it will expire at the verified session close."
        :data.status==="PARTIALLY_FILLED"?"LIMIT order partially filled. Remaining quantity is still reserved."
        :"LIMIT order status: "+data.status+".","success");
      priceInput.value="";
      await loadOrders();
    }catch(error){
      if(currentUser()!==uid)return;
      if([400,401,403,404,409,422].includes(error.status))clearPending(uid);
      show(error.message||"Futures LIMIT submission failed.","error");
    }finally{
      submitting=false;
      [buyButton,sellButton].forEach(button=>button.removeAttribute("aria-busy"));
      updateTicket();
    }
  }
  async function cancel(orderId,button){
    if(cancelling||!/^[a-f0-9]{64}$/.test(orderId||""))return;
    cancelling=true;button.disabled=true;
    try{
      const data=await api("/paper/futures/orders/"+encodeURIComponent(orderId)+"/cancel",{method:"POST",body:"{}"});
      show("Futures order status: "+String(data.status||"CANCELLED")+".","success");
    }catch(error){show(error.message||"Futures LIMIT cancellation failed.","error");}
    finally{cancelling=false;await loadOrders();}
  }

  buyButton.addEventListener("click",()=>submit("BUY"));
  sellButton.addEventListener("click",()=>submit("SELL"));
  refreshButton?.addEventListener("click",refresh);
  ordersBody.addEventListener("click",event=>{
    const button=event.target.closest(".futures-limit-cancel");
    if(button)cancel(button.dataset.orderId,button);
  });
  window.addEventListener("zenura:instrument-selected",event=>{
    selected=event.detail?.instrument||null;updateTicket();
  });
  window.addEventListener("zenura-market-auth-ready",()=>refresh());
  window.addEventListener("storage",event=>{
    if(event.key&&event.key.startsWith(pendingPrefix)&&event.newValue===null)updateTicket();
  });
  updateTicket();loadHealth();
  if(currentUser())refresh();
})();
