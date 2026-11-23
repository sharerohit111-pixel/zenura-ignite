/* Isolated NSE long-options LIMIT ticket. Backend flags keep it disabled by default. */
(function(){
  "use strict";
  const panel=document.getElementById("options-limit-ticket");
  if(!panel)return;
  const gateway=(document.querySelector('meta[name="market-gateway-url"]')?.content||"").trim().replace(/\/+$/,"");
  const search=document.getElementById("options-limit-search");
  const searchButton=document.getElementById("options-limit-search-button");
  const contractSelect=document.getElementById("options-limit-contract");
  const lotsInput=document.getElementById("options-limit-lots");
  const priceInput=document.getElementById("options-limit-price");
  const buyButton=document.getElementById("options-limit-buy");
  const sellButton=document.getElementById("options-limit-sell");
  const refreshButton=document.getElementById("options-limit-refresh");
  const status=document.getElementById("options-limit-status");
  const ordersBody=document.getElementById("options-limit-orders");
  const connector=()=>window.ZENURA_MARKET_CONNECTOR;
  let instruments=new Map(),selected=null,featureEnabled=false,loading=false,submitting=false,requestSeq=0;
  const pendingKey="zenura:options-limit:pending:v1";
  function setStatus(message,state){
    status.textContent=message;
    if(state)status.dataset.state=state;else delete status.dataset.state;
  }
  function money(paise){
    if(paise===null||paise===undefined||paise==="")return "—";
    if(!Number.isSafeInteger(Number(paise)))return "—";
    return new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(Number(paise)/100);
  }
  function parsePricePaise(value){
    const raw=String(value||"").trim();
    if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return null;
    const [whole,fraction=""]=raw.split(".");
    const paise=Number(whole)*100+Number((fraction+"00").slice(0,2));
    return Number.isSafeInteger(paise)&&paise>0?paise:null;
  }
  function setButtons(){
    const ready=featureEnabled&&!loading&&!submitting&&!!selected;
    buyButton.disabled=!ready;
    sellButton.disabled=!ready;
    searchButton.disabled=loading;
    refreshButton.disabled=loading;
  }
  async function authHeaders(){
    const c=connector();
    if(!c?.getIdToken||!c?.getUserId?.())throw new Error("Sign in to your Paper Trading account first.");
    const token=await c.getIdToken();
    if(!token)throw new Error("Your session expired. Sign in again.");
    return {Authorization:"Bearer "+token,Accept:"application/json"};
  }
  async function loadFeatureStatus(){
    if(!gateway){featureEnabled=false;setStatus("Market gateway URL is not configured. Options LIMIT remains disabled.");setButtons();return;}
    try{
      const response=await fetch(gateway+"/health",{headers:{Accept:"application/json"},cache:"no-store"});
      const health=await response.json();
      featureEnabled=response.ok&&health.optionsLimitSubmissionEnabled===true&&health.optionsLimitWorker?.enabled===true;
      if(!featureEnabled)setStatus("NSE Options LIMIT is disabled until staging, market-data rights and compliance sign-off are complete.");
      else setStatus("NSE Options LIMIT is enabled for Paper Trading. No exchange order is sent.");
    }catch(_){
      featureEnabled=false;
      setStatus("Could not verify Options LIMIT gateway readiness. Ticket remains disabled.");
    }
    setButtons();
  }
  function renderInstrumentOptions(rows){
    instruments=new Map(rows.map(item=>[item.instrument_key,item]));
    contractSelect.textContent="";
    const placeholder=document.createElement("option");
    placeholder.value="";placeholder.textContent=rows.length?"Choose a verified NSE CE/PE contract":"No NSE option contracts found";
    contractSelect.append(placeholder);
    rows.forEach(item=>{
      const option=document.createElement("option");
      option.value=item.instrument_key;
      const expiry=typeof item.expiry==="string"?item.expiry:new Date(Number(item.expiry)).toLocaleDateString("en-IN");
      option.textContent=[item.trading_symbol,item.instrument_type,expiry,"lot "+item.lot_size].filter(Boolean).join(" · ");
      contractSelect.append(option);
    });
    contractSelect.disabled=rows.length===0;
    selected=null;setButtons();
  }
  async function searchContracts(){
    if(!gateway){setStatus("Market gateway URL is not configured.","error");return;}
    const query=search.value.trim();
    if(query.length<2){setStatus("Enter at least two letters to search NSE option contracts.","warning");return;}
    const seq=++requestSeq;loading=true;setButtons();setStatus("Loading verified NSE option contracts…");
    try{
      const params=new URLSearchParams({kind:"options",exchange:"NSE",q:query,limit:"100"});
      const response=await fetch(gateway+"/instruments?"+params.toString(),{headers:{Accept:"application/json"}});
      const data=await response.json();
      if(seq!==requestSeq)return;
      if(!response.ok)throw new Error(data.error||"NSE instrument master is unavailable.");
      const rows=(data.results||[]).filter(item=>item.exchange==="NSE"&&item.segment==="NSE_FO"&&["CE","PE"].includes(item.instrument_type));
      renderInstrumentOptions(rows);
      setStatus(rows.length+" verified NSE CE/PE contracts loaded. Select one to continue.",rows.length?"success":"warning");
    }catch(error){
      if(seq===requestSeq){renderInstrumentOptions([]);setStatus(error.message||"Could not load NSE options.","error");}
    }finally{if(seq===requestSeq){loading=false;setButtons();}}
  }
  function readPending(){
    const c=connector(),uid=c?.getUserId?.();
    if(!uid)return null;
    try{
      const raw=localStorage.getItem(pendingKey+":"+uid);
      if(!raw)return null;
      const value=JSON.parse(raw);
      return value&&typeof value.fingerprint==="string"&&typeof value.key==="string"?value:null;
    }catch(_){return {unreadable:true};}
  }
  function savePending(value){
    const uid=connector()?.getUserId?.();
    if(!uid||!window.crypto?.randomUUID)return false;
    try{localStorage.setItem(pendingKey+":"+uid,JSON.stringify(value));return true;}catch(_){return false;}
  }
  function clearPending(){
    const uid=connector()?.getUserId?.();
    if(!uid)return;
    try{localStorage.removeItem(pendingKey+":"+uid);}catch(_){}
  }
  async function submit(side){
    if(submitting||!featureEnabled||!selected)return;
    const c=connector(),uid=c?.getUserId?.();
    if(!uid){setStatus("Sign in to your Paper Trading account before submitting an Options LIMIT order.","error");return;}
    const lots=Number(lotsInput.value),limitPricePaise=parsePricePaise(priceInput.value);
    if(!Number.isSafeInteger(lots)||lots<1||lots>10000){setStatus("Enter a whole-number lot count between 1 and 10,000.","error");return;}
    if(!limitPricePaise){setStatus("Enter a positive limit price with at most two decimal places.","error");return;}
    const fingerprint=JSON.stringify({instrumentKey:selected.instrument_key,side,lots,limitPricePaise});
    let pending=readPending();
    if(pending?.unreadable){setStatus("Saved retry data is unreadable. No order was sent; resolve browser storage first.","error");return;}
    if(pending&&pending.fingerprint!==fingerprint){
      setStatus("A previous Options LIMIT response is uncertain. Retry the exact same contract, side, lots and price before changing the ticket.","warning");return;
    }
    if(!pending){
      pending={fingerprint,key:window.crypto?.randomUUID?.()};
      if(!pending.key||!savePending(pending)){setStatus("Secure retry storage is unavailable. No order was sent.","error");return;}
    }
    submitting=true;setButtons();setStatus("Verifying your session, NSE contract and fresh executable quote…");
    try{
      const headers=await authHeaders();
      if(connector()?.getUserId?.()!==uid)throw new Error("Account changed while the order was processing. Sign in again to verify its result.");
      const response=await fetch(gateway+"/paper/derivative/limit-orders",{
        method:"POST",headers:{...headers,"Content-Type":"application/json"},
        body:JSON.stringify({instrument_key:selected.instrument_key,side,lots,limit_price_paise:limitPricePaise,idempotency_key:pending.key})
      });
      const data=await response.json().catch(()=>({}));
      if(connector()?.getUserId?.()!==uid)throw new Error("Account changed while the order was processing. Sign in again to verify its result.");
      if(!response.ok){
        if([400,401,403,404,409,422].includes(response.status))clearPending();
        throw new Error(data.error||"Options LIMIT order could not be submitted.");
      }
      if(typeof data.orderId!=="string"||!["PENDING","PARTIALLY_FILLED","FILLED"].includes(data.status)){
        throw new Error("Options LIMIT response could not be verified. Retry the same request to safely check its result.");
      }
      clearPending();
      setStatus(side+" LIMIT order "+data.status.toLowerCase()+" · virtual reservation confirmed · SIMULATION ONLY","success");
      await loadOrders();
    }catch(error){
      if(connector()?.getUserId?.()===uid)setStatus(error.message||"Options LIMIT submission failed.","error");
    }finally{submitting=false;setButtons();}
  }
  async function loadOrders(){
    const c=connector(),uid=c?.getUserId?.();
    if(!gateway||!uid||!c?.getIdToken){
      ordersBody.textContent="";
      const row=document.createElement("tr"),cell=document.createElement("td");
      cell.colSpan=10;cell.textContent="Sign in to view private Options LIMIT orders.";row.append(cell);ordersBody.append(row);return;
    }
    try{
      const headers=await authHeaders();
      const response=await fetch(gateway+"/paper/derivative/limit-orders?limit=50",{headers});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Options LIMIT history unavailable.");
      ordersBody.textContent="";
      if(!data.orders?.length){
        const row=document.createElement("tr"),cell=document.createElement("td");
        cell.colSpan=10;cell.textContent="No Options LIMIT orders recorded yet.";row.append(cell);ordersBody.append(row);return;
      }
      data.orders.forEach(order=>{
        const row=document.createElement("tr");
        const lots=order.quantity?Math.ceil(order.quantity/Math.max(1,Number(order.lotSize||order.quantity))):"—";
        const values=[
          order.createdAt?new Date(order.createdAt).toLocaleString("en-IN"):"—",
          order.tradingSymbol+" · "+order.instrumentType,
          order.side,lots,money(order.limitPricePaise),
          order.filledQuantity+" / "+order.remainingQuantity,
          money(order.averageFillPricePaise),money(order.cumulativeChargesPaise),
          order.status+" · SIM"
        ];
        values.forEach(value=>{const cell=document.createElement("td");cell.textContent=String(value??"—");row.append(cell);});
        const action=document.createElement("td");
        if(["PENDING","PARTIALLY_FILLED"].includes(order.status)){
          const cancel=document.createElement("button");cancel.type="button";cancel.textContent="CANCEL";
          cancel.addEventListener("click",()=>cancelOrder(order.id,cancel));
          action.append(cancel);
        }else action.textContent="—";
        row.append(action);ordersBody.append(row);
      });
    }catch(error){
      ordersBody.textContent="";
      const row=document.createElement("tr"),cell=document.createElement("td");
      cell.colSpan=10;cell.textContent=error.message||"Options LIMIT history unavailable.";row.append(cell);ordersBody.append(row);
    }
  }
  async function cancelOrder(orderId,button){
    const c=connector(),uid=c?.getUserId?.();
    if(!uid||!gateway)return;
    button.disabled=true;
    try{
      const headers=await authHeaders();
      if(connector()?.getUserId?.()!==uid)throw new Error("Account changed. Sign in again.");
      const response=await fetch(gateway+"/paper/derivative/limit-orders/"+encodeURIComponent(orderId),{
        method:"DELETE",headers
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Options LIMIT cancellation failed.");
      setStatus("Order "+data.status.toLowerCase()+" · remaining reservation released · SIMULATION ONLY","success");
      await loadOrders();
    }catch(error){setStatus(error.message||"Options LIMIT cancellation failed.","error");button.disabled=false;}
  }
  searchButton.addEventListener("click",searchContracts);
  search.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();searchContracts();}});
  contractSelect.addEventListener("change",()=>{
    selected=instruments.get(contractSelect.value)||null;
    if(selected)setStatus(selected.trading_symbol+" · "+selected.instrument_type+" · lot "+selected.lot_size+" · tick "+selected.tick_size+" selected.");
    setButtons();
  });
  buyButton.addEventListener("click",()=>submit("BUY"));
  sellButton.addEventListener("click",()=>submit("SELL"));
  refreshButton.addEventListener("click",()=>{loadFeatureStatus();loadOrders();});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden){loadFeatureStatus();loadOrders();}});
  window.addEventListener("zenura-market-auth-ready",()=>{loadFeatureStatus();loadOrders();});
  loadFeatureStatus();
  loadOrders();
})();
