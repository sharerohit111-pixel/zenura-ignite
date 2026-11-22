(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const gateway=(document.querySelector('meta[name="market-gateway-url"]')?.content||"").trim().replace(/\/+$/,"");
  const searchInput=$("investing-search"),searchResults=$("investing-search-results"),watchlistBox=$("investing-watchlist");
  const symbolTitle=$("investing-symbol-title"),symbolSub=$("investing-symbol-sub"),livePrice=$("investing-live-price");
  const chartStatus=$("chart-status"),orderStatus=$("investing-order-status");
  const buyButton=$("investing-buy"),sellButton=$("investing-sell"),quantityInput=$("investing-quantity");
  const positionsBody=$("investing-positions"),ordersBody=$("investing-orders");
  const timeframeButtons=[...document.querySelectorAll("#chart-timeframes [data-timeframe]")];
  let selected=null,activeTimeframe="5m",searchSequence=0,searchTimer=null,streamAbort=null,reconnectTimer=null,staleTimer=null,reconnectAttempt=0,lastQuote=null;
  let authUserId=null,watchlistItems=[],streamSequence=0,dataRequestSeq=0;
  const pendingKey="zenura-paper-investing-order-v1";
  function fmt(value){return "₹"+(Number(value||0)/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});}
  function safeText(el,value){if(el){const raw=value==null?"":String(value);el.textContent=window.ZenuraLanguage?.t?.(raw)||raw;}}
  function connector(){return window.ZENURA_MARKET_CONNECTOR;}
  async function authHeaders(){
    const c=connector(),token=await c?.getIdToken?.();
    if(!token)throw new Error("Sign in to continue.");
    return {Authorization:"Bearer "+token,Accept:"application/json"};
  }
  async function api(path,options={}){
    if(!gateway)throw new Error("Market gateway URL is not configured yet.");
    const c=connector(),uid=c?.getUserId?.();
    if(!uid)throw new Error("Sign in to continue.");
    const headers=await authHeaders();
    if(c.getUserId()!==uid)throw new Error("Account changed during the request. Sign in again.");
    const response=await fetch(gateway+path,{...options,headers:{...headers,...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})},cache:"no-store",signal:AbortSignal.timeout(20000)});
    const data=await response.json().catch(()=>({}));
    if(c.getUserId()!==uid)throw new Error("Account changed during the request. Sign in again.");
    if(!response.ok){const error=new Error(data.error||"Market service request failed ("+response.status+").");error.status=response.status;throw error;}
    return data;
  }
  function renderSearch(items,message){
    searchResults.replaceChildren();
    if(!items.length){const p=document.createElement("p");p.textContent=message||"No matching NSE/BSE stocks found.";searchResults.append(p);return;}
    for(const item of items){
      const button=document.createElement("button");button.type="button";button.className="investing-search-item";
      const strong=document.createElement("strong");strong.textContent=item.trading_symbol||item.name||item.instrument_key;
      const small=document.createElement("small");small.textContent=(item.exchange||"")+" · "+(item.name||item.instrument_key);
      button.append(strong,small);button.addEventListener("click",()=>selectInstrument(item));searchResults.append(button);
    }
  }
  async function searchStocks(){
    const sequence=++searchSequence,q=searchInput.value.trim();
    if(!q){renderSearch([],"Search the official NSE/BSE stock instrument master.");return;}
    try{
      const params=new URLSearchParams({kind:"equities",q,limit:"50"});
      const response=await fetch(gateway+"/instruments?"+params,{headers:{Accept:"application/json"},cache:"public"});
      const payload=await response.json().catch(()=>({}));
      if(sequence!==searchSequence)return;
      if(!response.ok)throw new Error(payload.error||"Stock search is unavailable.");
      renderSearch(payload.results||[]);
    }catch(error){if(sequence===searchSequence)renderSearch([],error.message);}
  }
  async function loadWatchlist(){
    const uid=connector()?.getUserId?.();
    if(!uid){watchlistBox.textContent="Sign in to load your watchlist.";return;}
    try{
      const payload=await api("/watchlist?name=My%20Stocks");
      watchlistItems=payload.items||[];
      const quotes=await api("/watchlist/quotes?name=My%20Stocks").catch(()=>({quotes:[]}));
      const quoteMap=new Map((quotes.quotes||[]).map(q=>[q.instrumentKey,q]));
      watchlistBox.replaceChildren();
      if(!watchlistItems.length){watchlistBox.textContent="Your watchlist is empty. Select a stock and add it.";return;}
      for(const item of watchlistItems){
        const row=document.createElement("button");row.type="button";row.className="investing-watchlist-item";
        const label=document.createElement("span");label.textContent=item.trading_symbol||item.name||item.instrument_key;
        const quote=quoteMap.get(item.instrument_key),price=document.createElement("b");
        price.textContent=quote?.lastPrice!=null?fmt(Math.round(quote.lastPrice*100)):"—";
        row.append(label,price);row.addEventListener("click",()=>selectInstrument(item));watchlistBox.append(row);
      }
    }catch(error){if(connector()?.getUserId?.()===uid)watchlistBox.textContent=error.message||"Watchlist could not be loaded.";}
  }
  async function addToWatchlist(){
    if(!selected)return;
    const uid=connector()?.getUserId?.();if(!uid)return;
    try{
      const current=watchlistItems.map(x=>x.instrument_key);
      if(current.includes(selected.instrument_key)){orderStatus.textContent="This stock is already in your watchlist.";return;}
      if(current.length>=50)throw new Error("Watchlist limit is 50 stocks.");
      await api("/watchlist",{method:"PUT",body:JSON.stringify({name:"My Stocks",instrumentKeys:[...current,selected.instrument_key]})});
      await loadWatchlist();orderStatus.textContent="Added to your saved watchlist.";
    }catch(error){if(connector()?.getUserId?.()===uid)orderStatus.textContent=error.message;}
  }
  async function loadAccount(){
    const data=await api("/paper/investing/account");
    safeText($("investing-cash"),fmt(data.cashPaise));
    safeText($("investing-starting-cash"),fmt(data.startingCashPaise));
  }
  function renderPositions(data){
    const rows=data.positions||[];positionsBody.replaceChildren();
    if(!rows.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=6;td.textContent="No long-term holdings yet.";tr.append(td);positionsBody.append(tr);return;}
    for(const p of rows){
      const tr=document.createElement("tr");
      const cells=[p.tradingSymbol||p.instrumentKey,p.quantity,fmt(p.averagePricePaise),p.lastPricePaise?fmt(p.lastPricePaise):"—",p.marketValuePaise?fmt(p.marketValuePaise):"—",p.unrealizedPnlPaise==null?"—":fmt(p.unrealizedPnlPaise)];
      cells.forEach((v,i)=>{const td=document.createElement("td");td.textContent=String(v);if(i===5)td.className=Number(p.unrealizedPnlPaise)>=0?"positive":"negative";tr.append(td);});
      positionsBody.append(tr);
    }
  }
  async function loadPortfolio(){
    const data=await api("/paper/investing/portfolio");
    safeText($("investing-cash"),fmt(data.cashPaise));
    safeText($("investing-market-value"),fmt(data.marketValuePaise));
    safeText($("investing-unrealized"),fmt(data.unrealizedPnlPaise));
    safeText($("investing-equity"),fmt(data.equityPaise));
    safeText($("investing-portfolio-status"),data.valuationStatus==="fresh"?"All holdings valued from fresh provider quotes.":data.valuationStatus==="no_open_positions"?"No open holdings.":"Some holding quotes are stale or unavailable.");
    renderPositions(data);
  }
  async function loadOrders(){
    const data=await api("/paper/investing/orders?limit=50");
    ordersBody.replaceChildren();
    if(!(data.orders||[]).length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=7;td.textContent="No investing orders yet.";tr.append(td);ordersBody.append(tr);}
    for(const o of data.orders||[]){
      const tr=document.createElement("tr"),cells=[o.createdAt?new Date(o.createdAt).toLocaleString("en-IN"):"—",o.tradingSymbol||o.instrumentKey,o.side,o.quantity,fmt(o.executionPricePaise),fmt(o.chargesPaise),o.status];
      cells.forEach(v=>{const td=document.createElement("td");td.textContent=String(v);tr.append(td);});ordersBody.append(tr);
    }
    safeText($("investing-orders-status"),(data.orders||[]).length+" latest orders");
  }
  async function refreshAll(){
    const uid=connector()?.getUserId?.();if(!uid)return;
    const request=++dataRequestSeq;
    safeText($("investing-portfolio-status"),"Refreshing private Paper Investing ledger…");
    try{
      await loadAccount();await Promise.all([loadPortfolio(),loadOrders(),loadWatchlist()]);
      if(request!==dataRequestSeq||connector()?.getUserId?.()!==uid)return;
    }catch(error){
      if(request===dataRequestSeq&&connector()?.getUserId?.()===uid)
        safeText($("investing-portfolio-status"),error.message||"Investing data could not be refreshed.");
    }
  }
  function updateOrderButtons(){
    const ready=!!selected&&!!lastQuote&&!!connector()?.getUserId?.()&&!streamAbort?.signal.aborted;
    buyButton.disabled=!ready;sellButton.disabled=!ready;
  }
  function clearStream(){
    streamSequence++;
    if(streamAbort){streamAbort.abort();streamAbort=null;}
    if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
    if(staleTimer){clearTimeout(staleTimer);staleTimer=null;}
  }
  function scheduleReconnect(item,uid){
    if(reconnectTimer||!selected||selected.instrument_key!==item.instrument_key||connector()?.getUserId?.()!==uid)return;
    const delay=Math.min(30000,1000*Math.pow(2,Math.min(reconnectAttempt++,5)));
    reconnectTimer=setTimeout(()=>{reconnectTimer=null;if(selected?.instrument_key===item.instrument_key&&connector()?.getUserId?.()===uid)startStream(item,uid);},delay);
  }
  async function startStream(item,uid){
    clearStream();const sequence=streamSequence,controller=new AbortController();streamAbort=controller;
    if(!gateway||!connector()?.getIdToken){safeText(chartStatus,"Market gateway is not configured.");return;}
    try{
      const token=await connector().getIdToken();
      if(controller.signal.aborted||connector().getUserId()!==uid||selected?.instrument_key!==item.instrument_key)return;
      const response=await fetch(gateway+"/stream",{method:"POST",signal:controller.signal,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify({instrumentKeys:[item.instrument_key],mode:"ltpc"})});
      if(!response.ok)throw new Error("Live market feed unavailable ("+response.status+").");
      if(!response.body)throw new Error("Streaming is not supported in this browser.");
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="";
      while(true){
        const {value,done}=await reader.read();
        if(controller.signal.aborted||connector().getUserId()!==uid||selected?.instrument_key!==item.instrument_key)break;
        const parsed=window.ZenuraSseParser.parseSseChunk(buffer,decoder.decode(value||new Uint8Array(),{stream:!done}));
        buffer=parsed.buffer;
        for(const event of parsed.events){
          let data;try{data=JSON.parse(event.data);}catch(_){continue;}
          if(event.event==="status"&&data.connected===true)safeText(chartStatus,"Live Upstox V3 feed connected");
          if(event.event==="error"){safeText(chartStatus,data.message||"Live market feed error");}
          if(event.event==="market"){
            const quote=window.ZenuraLiveQuote.extractFreshQuote(data.feeds?.[item.instrument_key]);
            if(quote){
              lastQuote=quote;reconnectAttempt=0;window.ZenuraProfessionalChart?.updateQuote(quote);
              safeText(livePrice,fmt(quote.pricePaise));safeText($("investing-reference-price"),fmt(quote.pricePaise));
              safeText(symbolSub,"Live quote · "+Math.max(0,quote.quoteAgeMs)+" ms old");
              if(staleTimer)clearTimeout(staleTimer);
              staleTimer=setTimeout(()=>{lastQuote=null;safeText(livePrice,"STALE");safeText(chartStatus,"No fresh quote for 15 seconds");updateOrderButtons();scheduleReconnect(item,uid);},15000);
              updateOrderButtons();
            }
          }
        }
        if(done)break;
      }
      if(!controller.signal.aborted)scheduleReconnect(item,uid);
    }catch(error){
      if(!controller.signal.aborted){safeText(chartStatus,error.message||"Live feed disconnected");scheduleReconnect(item,uid);}
    }
  }
  async function selectInstrument(item){
    clearStream();selected=item;lastQuote=null;updateOrderButtons();
    safeText(symbolTitle,item.trading_symbol||item.name||item.instrument_key);
    safeText(symbolSub,(item.exchange||"")+" · "+item.instrument_key);
    safeText(livePrice,"—");safeText($("investing-reference-price"),"—");
    safeText(chartStatus,"Loading professional chart…");
    const c=connector(),uid=c?.getUserId?.();
    if(!uid){safeText(orderStatus,"Sign in to connect market data and use Paper Investing.");return;}
    try{
      await window.ZenuraProfessionalChart.mount({
        container:$("market-chart"),instrument:{...item},timeframe:activeTimeframe,gateway,
        getAccessToken:()=>c.getIdToken(),supabase:window.ZENURA_SUPABASE,
        onTimeframeChange:next=>{activeTimeframe=next;timeframeButtons.forEach(b=>b.classList.toggle("active",b.dataset.timeframe===next));},
        onError:error=>safeText(chartStatus,error.message||"Historical chart data unavailable.")
      });
      if(c.getUserId()!==uid||selected?.instrument_key!==item.instrument_key)return;
      safeText(chartStatus,"Professional chart · "+activeTimeframe);
      startStream(item,uid);
    }catch(error){safeText(chartStatus,error.message||"Professional chart could not be loaded.");}
  }
  function pendingOrder(uid,fingerprint){
    let raw=null;try{raw=sessionStorage.getItem(pendingKey);}catch(_){throw new Error("Browser session storage is unavailable; no order was sent.");}
    if(raw){
      let p;try{p=JSON.parse(raw);}catch(_){throw new Error("A previous investing order response is uncertain. Clear browser session only after checking order history.");}
      if(p.uid!==uid||p.fingerprint!==fingerprint)throw new Error("A previous investing order response is uncertain. Retry the same stock, side and quantity first.");
      return p.key;
    }
    if(!crypto.randomUUID)throw new Error("Secure order request IDs are not available in this browser.");
    const key=crypto.randomUUID();sessionStorage.setItem(pendingKey,JSON.stringify({uid,fingerprint,key}));return key;
  }
  async function submitOrder(side){
    if(!selected||!lastQuote)return;
    const uid=connector()?.getUserId?.(),quantity=Number(quantityInput.value);
    if(!uid||!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000){safeText(orderStatus,"Enter a valid quantity and sign in.");return;}
    const fingerprint=[selected.instrument_key,side,quantity].join("|");
    let idempotencyKey;
    try{idempotencyKey=pendingOrder(uid,fingerprint);}catch(error){safeText(orderStatus,error.message);return;}
    buyButton.disabled=true;sellButton.disabled=true;safeText(orderStatus,"Verifying fresh market price and executing virtual investment…");
    try{
      const data=await api("/paper/investing/orders",{method:"POST",body:JSON.stringify({instrument_key:selected.instrument_key,side,quantity,order_type:"MARKET",idempotency_key:idempotencyKey})});
      if(connector().getUserId()!==uid)throw new Error("Account changed while the order was processing. Sign in to the original account to verify it.");
      if(typeof data.orderId!=="string"||!Number.isSafeInteger(data.executionPricePaise)||data.executionPricePaise<1)throw new Error("Order response could not be verified. Retry the same order to safely check its result.");
      sessionStorage.removeItem(pendingKey);
      safeText(orderStatus,side+" "+quantity+" "+(data.tradingSymbol||selected.trading_symbol)+" filled at "+fmt(data.executionPricePaise)+" · Charges "+fmt(data.chargesPaise)+" · Virtual only.");
      await refreshAll();
    }catch(error){
      if([400,401,403,404,422].includes(error.status)){try{sessionStorage.removeItem(pendingKey);}catch(_){}}
      if(connector()?.getUserId?.()===uid)safeText(orderStatus,error.message||"Paper Investing order failed.");
    }
    finally{updateOrderButtons();}
  }
  searchInput.addEventListener("input",()=>{if(searchTimer)clearTimeout(searchTimer);searchTimer=setTimeout(searchStocks,250);});
  $("investing-watchlist-refresh").addEventListener("click",loadWatchlist);
  $("investing-refresh").addEventListener("click",refreshAll);
  buyButton.addEventListener("click",()=>submitOrder("BUY"));
  sellButton.addEventListener("click",()=>submitOrder("SELL"));
  timeframeButtons.forEach(button=>button.addEventListener("click",()=>{
    const next=button.dataset.timeframe;if(!window.ZenuraProfessionalChart||!selected)return;
    activeTimeframe=next;timeframeButtons.forEach(b=>b.classList.toggle("active",b===button));
    selectInstrument(selected);
  }));
  const addWatchlist=document.createElement("button");addWatchlist.type="button";addWatchlist.textContent="ADD TO WATCHLIST";addWatchlist.className="investing-add-watchlist";
  $("investing-symbol-sub").after(addWatchlist);addWatchlist.addEventListener("click",addToWatchlist);
  function clearPrivateSession(){
    dataRequestSeq++;authUserId=null;watchlistItems=[];clearStream();lastQuote=null;selected=null;
    window.ZenuraProfessionalChart?.destroy();
    safeText(symbolTitle,"No stock selected");safeText(symbolSub,"Sign in to load market data");
    safeText(livePrice,"—");safeText($("investing-reference-price"),"—");
    safeText($("investing-cash"),"—");safeText($("investing-starting-cash"),"—");
    safeText($("investing-market-value"),"—");safeText($("investing-unrealized"),"—");
    safeText($("investing-equity"),"—");safeText($("investing-portfolio-status"),"Sign in to view your private investing portfolio.");
    safeText($("investing-orders-status"),"Sign in required");safeText(chartStatus,"Sign in to load the professional chart");
    safeText(orderStatus,"Sign in to use Paper Investing.");
    positionsBody.replaceChildren();ordersBody.replaceChildren();
    const p=document.createElement("tr"),pd=document.createElement("td");pd.colSpan=6;pd.textContent="Sign in to view private holdings.";p.append(pd);positionsBody.append(p);
    const o=document.createElement("tr"),od=document.createElement("td");od.colSpan=7;od.textContent="Sign in to view private order history.";o.append(od);ordersBody.append(o);
    watchlistBox.textContent="Sign in to load your private watchlist.";
    updateOrderButtons();
  }
  window.addEventListener("zenura-market-auth-ready",event=>{
    clearPrivateSession();
    if(!event.detail?.signedIn)return;
    const uid=connector()?.getUserId?.();
    if(uid){authUserId=uid;refreshAll();}
  });
  window.addEventListener("zenura-language-change",event=>{
    const language=event.detail?.language||window.ZenuraLanguage?.getLanguage?.()||"en";
    safeText($("paper-chart-theme-toggle"),window.ZenuraChartTheme?.actionLabel(document.body.dataset.chartTheme||"dark",language)||"CHART THEME");
  });
  window.addEventListener("pagehide",clearStream,{once:true});
  if(!gateway){safeText(orderStatus,"Market gateway URL is not configured. Supabase sign-in is available, but live investing needs the deployed gateway.");}
  if(connector()?.getUserId?.())refreshAll();
  renderSearch([],"Search the official NSE/BSE stock instrument master.");
})();
