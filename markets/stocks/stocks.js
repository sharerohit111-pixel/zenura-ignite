/* Indian Stock Market terminal — official instrument master and verified live feed only. */
(function(){
  'use strict';
  const tabs=[...document.querySelectorAll('[data-list]')];
  const title=document.getElementById('selected-name');
  const symbol=document.getElementById('selected-symbol');
  const price=document.getElementById('selected-price');
  const search=document.getElementById('instrument-search');
  const list=document.getElementById('instrument-list');
  const gateway=(document.querySelector('meta[name="market-gateway-url"]')?.content||'').trim().replace(/\/+$/,'');
  const labels={indices:'Indices',equities:'Equities',futures:'Futures',options:'Options'};
  let activeList='indices',items=[],selected=null,streamAbort=null,debounce=null,reconnectTimer=null,staleTimer=null,reconnectAttempt=0,lastQuoteText='',instrumentLoadSeq=0;
  function clearFeedTimers(){if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}if(staleTimer){clearTimeout(staleTimer);staleTimer=null;}}
  function message(text){list.textContent='';const el=document.createElement('div');el.className='empty';el.textContent=text;list.append(el);}
  function escapeText(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
  function render(rows){
    list.textContent='';
    if(!rows.length){message('No instruments matched this search.');return;}
    rows.forEach(item=>{
      const b=document.createElement('button');b.type='button';b.className='instrument-row'+(selected?.instrument_key===item.instrument_key?' active':'');
      const n=document.createElement('b');n.textContent=item.trading_symbol||item.name||item.instrument_key;
      const d=document.createElement('small');d.textContent=[item.exchange,item.instrument_type,item.expiry?new Date(Number(item.expiry)).toLocaleDateString('en-IN'):''].filter(Boolean).join(' · ');
      b.append(n,d);b.addEventListener('click',()=>select(item));list.append(b);
    });
  }
  async function loadInstruments(){
    const request=++instrumentLoadSeq,requestedList=activeList,requestedQuery=search.value.trim();
    const connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.();
    if(!gateway){message('Market gateway URL is not configured yet. Deploy Cloud Run and set the market-gateway-url meta value.');return;}
    if(!connector?.getIdToken||!uid){message('Sign in to load the official Upstox instrument master.');return;}
    message('Loading official Upstox instrument master…');
    const params=new URLSearchParams({kind:requestedList,limit:'100'});
    if(requestedQuery)params.set('q',requestedQuery);
    try{
      const token=await connector.getIdToken();
      if(request!==instrumentLoadSeq||connector.getUserId()!==uid||requestedList!==activeList||requestedQuery!==search.value.trim())return;
      const response=await fetch(gateway+'/instruments?'+params.toString(),{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      if(!response.ok)throw new Error('Instrument service unavailable ('+response.status+').');
      const data=await response.json();
      if(request!==instrumentLoadSeq||connector.getUserId()!==uid||requestedList!==activeList||requestedQuery!==search.value.trim())return;
      items=data.results||[];render(items);
    }catch(error){if(request===instrumentLoadSeq&&connector.getUserId()===uid&&requestedList===activeList&&requestedQuery===search.value.trim())message(error.message||'Could not load instruments.');}
  }
  const watchAdd=document.getElementById('watchlist-add'),watchStatus=document.getElementById('watchlist-status'),watchBody=document.getElementById('saved-watchlist'),watchSelect=document.getElementById('watchlist-select');
  let savedWatchlist=[],watchQuotes=new Map(),activeWatchlist=watchSelect.value,watchlistLoadSeq=0,watchQuoteSeq=0;
  async function loadWatchlistQuotes(){
    const request=++watchQuoteSeq,name=activeWatchlist,items=savedWatchlist.slice(),connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.();
    if(!gateway||!connector?.getIdToken||!uid||!items.length){watchQuotes.clear();renderSavedWatchlist();return;}
    watchStatus.textContent='Refreshing verified watchlist prices…';
    try{
      const token=await connector.getIdToken();
      if(request!==watchQuoteSeq||connector.getUserId()!==uid||name!==activeWatchlist)return;
      const response=await fetch(gateway+'/watchlist/quotes?name='+encodeURIComponent(name),{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Watchlist quotes unavailable.');
      if(request!==watchQuoteSeq||connector.getUserId()!==uid||name!==activeWatchlist)return;
      watchQuotes=new Map((data.quotes||[]).map(q=>[q.instrumentKey,q]));
      renderSavedWatchlist();
      const fresh=(data.quotes||[]).filter(q=>q.status==='fresh').length;
      watchStatus.textContent=fresh+' of '+savedWatchlist.length+' watchlist prices are fresh provider quotes. '+(fresh<savedWatchlist.length?'Some prices are stale or unavailable.':'');
    }catch(error){if(request!==watchQuoteSeq||connector.getUserId()!==uid||name!==activeWatchlist)return;watchStatus.textContent=error.message||'Watchlist quotes unavailable.';renderSavedWatchlist();}
  }
  let watchlistSaveQueue=Promise.resolve(),watchlistEditSeq=0;
  function saveWatchlist(){
    const name=activeWatchlist,keys=savedWatchlist.map(x=>x.instrument_key),edit=watchlistEditSeq,connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.();
    if(!gateway||!connector?.getIdToken||!uid){watchStatus.textContent='Sign in and configure the gateway to save your watchlist.';return Promise.resolve(false);}
    const write=async()=>{
      if(name!==activeWatchlist)return false;
      try{
        if(!connector?.getIdToken||connector.getUserId()!==uid) return false;
        watchStatus.textContent='Saving your private watchlist…';
        const token=await connector.getIdToken();
        if(name!==activeWatchlist||edit!==watchlistEditSeq||connector.getUserId()!==uid)return false;
        const response=await fetch(gateway+'/watchlist',{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({name,instrumentKeys:keys})});
        const data=await response.json();if(!response.ok)throw new Error(data.error||'Watchlist save failed.');
        if(name===activeWatchlist&&edit===watchlistEditSeq&&connector.getUserId()===uid)watchStatus.textContent=data.count+' of 50 instruments saved to your account.';
        return connector.getUserId()===uid&&edit===watchlistEditSeq;
      }catch(error){if(name===activeWatchlist&&edit===watchlistEditSeq&&connector.getUserId()===uid)watchStatus.textContent=error.message||'Watchlist save failed.';return false;}
    };
    const result=watchlistSaveQueue.then(write,write);
    watchlistSaveQueue=result.then(()=>undefined,()=>undefined);
    return result;
  }
  function renderSavedWatchlist(){
    watchBody.textContent='';
    if(!savedWatchlist.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='No saved instruments yet.';watchBody.append(empty);}
    savedWatchlist.forEach(item=>{
      const row=document.createElement('div');row.className='saved-watch-row';
      const info=document.createElement('div');info.className='saved-watch-info';
      const pick=document.createElement('button');pick.type='button';pick.className='saved-watch-pick';pick.textContent=item.trading_symbol||item.name||item.instrument_key;pick.addEventListener('click',()=>select(item));
      const quote=watchQuotes.get(item.instrument_key),detail=document.createElement('small');detail.className='saved-watch-quote';
      if(quote?.status==='fresh'){
        const change=Number(quote.netChange||0),pct=quote.changePercent;
        detail.textContent='₹'+Number(quote.lastPrice).toLocaleString('en-IN',{maximumFractionDigits:2})+' · '+(change>0?'+':'')+change.toFixed(2)+(pct===null?'':' ('+(pct>0?'+':'')+pct.toFixed(2)+'%)');
        detail.classList.add(change>0?'positive':change<0?'negative':'neutral');
      }else detail.textContent=quote?'STALE / UNAVAILABLE':'Price not refreshed';
      info.append(pick,detail);
      const remove=document.createElement('button');remove.type='button';remove.className='saved-watch-remove';remove.textContent='REMOVE';remove.setAttribute('aria-label','Remove '+(item.trading_symbol||item.instrument_key)+' from watchlist');remove.addEventListener('click',async()=>{const previous=savedWatchlist;savedWatchlist=savedWatchlist.filter(x=>x.instrument_key!==item.instrument_key);const edit=++watchlistEditSeq;renderSavedWatchlist();if(!await saveWatchlist()&&edit===watchlistEditSeq){savedWatchlist=previous;watchlistEditSeq++;renderSavedWatchlist();}});
      row.append(info,remove);watchBody.append(row);
    });
    watchAdd.disabled=!selected||savedWatchlist.some(x=>x.instrument_key===selected.instrument_key)||savedWatchlist.length>=50||!window.ZENURA_MARKET_CONNECTOR?.getIdToken||!window.ZENURA_MARKET_CONNECTOR?.getUserId?.();
  }
  async function loadSavedWatchlist(){
    const request=++watchlistLoadSeq,name=activeWatchlist,connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.();if(!gateway||!connector?.getIdToken||!uid)return;
    try{
      const token=await connector.getIdToken();
      if(request!==watchlistLoadSeq||connector.getUserId()!==uid||name!==activeWatchlist)return;
      const response=await fetch(gateway+'/watchlist?name='+encodeURIComponent(name),{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Watchlist unavailable');
      if(request!==watchlistLoadSeq||connector.getUserId()!==uid||name!==activeWatchlist)return;
      savedWatchlist=data.items||[];renderSavedWatchlist();await loadWatchlistQuotes();
    }catch(error){if(request===watchlistLoadSeq&&connector.getUserId()===uid&&name===activeWatchlist)watchStatus.textContent=error.message||'Watchlist could not be loaded.';}
  }
  watchSelect.addEventListener('change',async()=>{activeWatchlist=watchSelect.value;watchlistLoadSeq++;watchQuoteSeq++;watchlistEditSeq++;savedWatchlist=[];watchQuotes.clear();renderSavedWatchlist();await loadSavedWatchlist();});
  watchAdd.addEventListener('click',async()=>{
    if(!selected||savedWatchlist.some(x=>x.instrument_key===selected.instrument_key)||savedWatchlist.length>=50)return;
    const previous=savedWatchlist;savedWatchlist=[...savedWatchlist,selected];const edit=++watchlistEditSeq;renderSavedWatchlist();if(!await saveWatchlist()){if(edit===watchlistEditSeq){savedWatchlist=previous;watchlistEditSeq++;renderSavedWatchlist();}}else if(edit===watchlistEditSeq)await loadWatchlistQuotes();
  });
  const watchRefresh=document.getElementById('watchlist-refresh');
  watchRefresh.addEventListener('click',loadWatchlistQuotes);
  const paperProductMode=document.getElementById('paper-product-mode'),paperCash=document.getElementById('paper-cash'),paperRealized=document.getElementById('paper-realized'),paperAccountStatus=document.getElementById('paper-account-status'),paperOrderStatus=document.getElementById('paper-order-status'),paperQuantity=document.getElementById('paper-quantity'),paperBuy=document.getElementById('paper-buy'),paperSell=document.getElementById('paper-sell');
  function inrPaise(value){const amount=Number(value||0)/100,formatted=Math.abs(amount).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});return amount<0?'-₹'+formatted:'₹'+formatted;}
  let paperAccountRequest=0;
  async function loadPaperAccount(){
    const connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.(),request=++paperAccountRequest;
    if(!gateway||!connector?.getIdToken||!uid)return;
    try{
      const token=await connector.getIdToken();if(request!==paperAccountRequest||connector.getUserId()!==uid)return;
      const response=await fetch(gateway+'/paper/account',{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      const data=await response.json();if(request!==paperAccountRequest||connector.getUserId()!==uid)return;if(!response.ok)throw new Error(data.error||'Paper account unavailable');
      paperCash.textContent=inrPaise(data.cashPaise);paperRealized.textContent=inrPaise(paperProductMode?.value==='INTRADAY'?(data.intradayRealizedPnlPaise??0):(data.deliveryRealizedPnlPaise??data.realizedPnlPaise));
      paperAccountStatus.textContent='Separate Indian-market virtual account · No real funds';
      updatePaperButtons();
    }catch(error){if(request===paperAccountRequest&&connector.getUserId()===uid)paperAccountStatus.textContent=error.message||'Paper account not ready';}
  }
  const paperMarketValue=document.getElementById('paper-market-value'),paperUnrealized=document.getElementById('paper-unrealized'),paperEquity=document.getElementById('paper-equity'),paperPortfolioStatus=document.getElementById('paper-portfolio-status'),paperPositions=document.getElementById('paper-positions'),paperHistory=document.getElementById('paper-history'),paperRefresh=document.getElementById('refresh-paper-portfolio'),paperHistoryMore=document.getElementById('paper-history-more'),paperHistoryStatus=document.getElementById('paper-history-status');
  function tableMessage(body,columns,message){body.textContent='';const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=columns;td.textContent=message;tr.append(td);body.append(tr);}
  function signedMoney(value){const n=Number(value||0);return (n>0?'+':n<0?'−':'')+inrPaise(Math.abs(n));}
  let paperPortfolioRequest=0;
  async function loadPaperPortfolio(){
    const connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.(),request=++paperPortfolioRequest;
    if(!gateway||!connector?.getIdToken||!uid)return;
    paperPortfolioStatus.textContent='Refreshing verified market valuation…';
    try{
      const token=await connector.getIdToken();if(request!==paperPortfolioRequest||connector.getUserId()!==uid)return;
      const product=paperProductMode?.value==='INTRADAY'?'INTRADAY':'DELIVERY';
      const response=await fetch(gateway+'/paper/portfolio?product='+product,{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      const data=await response.json();if(request!==paperPortfolioRequest||connector.getUserId()!==uid)return;if(!response.ok)throw new Error(data.error||'Portfolio valuation unavailable');
      paperMarketValue.textContent=inrPaise(data.marketValuePaise);paperUnrealized.textContent=signedMoney(data.unrealizedPnlPaise);paperEquity.textContent=inrPaise(data.equityPaise);
      paperPortfolioStatus.textContent=data.valuationStatus==='fresh'?'All holdings valued from fresh Upstox quotes.':data.valuationStatus==='no_open_positions'?'No open holdings.':'Some quotes are stale or unavailable; those positions are excluded from totals ('+data.stalePositions+').';
      paperPositions.textContent='';
      if(!data.positions?.length)tableMessage(paperPositions,6,'No open holdings.');
      else data.positions.forEach(p=>{
        const tr=document.createElement('tr');
        [p.tradingSymbol,p.quantity,inrPaise(p.averagePricePaise),p.lastPricePaise===null?'STALE':inrPaise(p.lastPricePaise),p.marketValuePaise===null?'—':inrPaise(p.marketValuePaise),p.unrealizedPnlPaise===null?'—':signedMoney(p.unrealizedPnlPaise)].forEach(v=>{const td=document.createElement('td');td.textContent=String(v);tr.append(td);});
        paperPositions.append(tr);
      });
    }catch(error){if(request===paperPortfolioRequest&&connector.getUserId()===uid)paperPortfolioStatus.textContent=error.message||'Portfolio refresh failed.';}
  }
  let paperHistoryCursor=null,paperHistoryHasMore=false,paperHistoryLoading=false,paperHistoryLoadSeq=0;
  async function loadPaperHistory({append=false}={}){
    const connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.();
    if(!gateway||!connector?.getIdToken||!uid)return;
    if(append&&(paperHistoryLoading||!paperHistoryHasMore||!paperHistoryCursor))return;
    const seq=++paperHistoryLoadSeq,cursor=paperHistoryCursor;paperHistoryLoading=true;paperHistoryMore.disabled=true;
    if(paperHistoryStatus)paperHistoryStatus.textContent=append?'Loading older orders…':'Loading latest orders…';
    try{
      const token=await connector.getIdToken();if(seq!==paperHistoryLoadSeq||connector.getUserId()!==uid)return;
      const params=new URLSearchParams({limit:'50'});
      if(append)params.set('cursor',cursor);
      const response=await fetch(gateway+'/paper/orders?'+params.toString(),{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      const data=await response.json();if(seq!==paperHistoryLoadSeq||connector.getUserId()!==uid)return;if(!response.ok)throw new Error(data.error||'Order history unavailable');
      if(!append)paperHistory.textContent='';
      if(!data.orders?.length&&!append)tableMessage(paperHistory,10,'No paper orders yet.');
      else data.orders.forEach(order=>{
        const tr=document.createElement('tr'),date=order.createdAt?new Date(order.createdAt).toLocaleString('en-IN'):'—';
        [date,order.tradingSymbol,order.product==='INTRADAY'?'INTRADAY':'DELIVERY',order.side,order.orderType||'MARKET',order.quantity,Number.isSafeInteger(order.executionPricePaise)?inrPaise(order.executionPricePaise):'—',order.chargesBreakdown?.schedule_version?inrPaise(order.chargesPaise):'—',Number.isSafeInteger(order.realizedPnlPaise)?signedMoney(order.realizedPnlPaise):'—',order.status+' · SIM'].forEach(v=>{const td=document.createElement('td');td.textContent=String(v);tr.append(td);});
        paperHistory.append(tr);
      });
      paperHistoryCursor=data.nextCursor||null;
      paperHistoryHasMore=!!data.hasMore&&!!paperHistoryCursor;
      if(paperHistoryStatus)paperHistoryStatus.textContent=paperHistoryHasMore?'Showing '+paperHistory.children.length+' orders':'All available orders loaded';
      paperHistoryMore.disabled=!paperHistoryHasMore;
    }catch(error){
      if(seq===paperHistoryLoadSeq&&connector.getUserId()===uid){if(paperHistoryStatus)paperHistoryStatus.textContent='Could not load order history';if(!append)tableMessage(paperHistory,8,error.message||'Could not load order history.');}
    }finally{if(seq===paperHistoryLoadSeq&&connector.getUserId()===uid){paperHistoryLoading=false;paperHistoryMore.disabled=!paperHistoryHasMore;}}
  }
  paperHistoryMore?.addEventListener('click',()=>loadPaperHistory({append:true}));
  paperProductMode?.addEventListener('change',()=>{loadPaperAccount();refreshPaperViews();});
  let derivativePortfolioRequest=0;
  async function loadDerivativePortfolio(){
    const connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.(),request=++derivativePortfolioRequest;
    const body=document.getElementById('derivative-positions'),status=document.getElementById('derivative-portfolio-status');
    if(!body||!status||!gateway||!connector?.getIdToken||!uid)return;
    status.textContent='Refreshing verified option quotes…';
    try{
      const token=await connector.getIdToken();
      if(request!==derivativePortfolioRequest||connector.getUserId()!==uid)return;
      const [response,historyResponse]=await Promise.all([
        fetch(gateway+'/paper/derivatives/portfolio',{headers:{Authorization:'Bearer '+token,Accept:'application/json'}}),
        fetch(gateway+'/paper/derivative/orders?limit=50',{headers:{Authorization:'Bearer '+token,Accept:'application/json'}})
      ]);
      const data=await response.json(),history=await historyResponse.json();
      if(request!==derivativePortfolioRequest||connector.getUserId()!==uid)return;
      if(!response.ok)throw new Error(data.error||'Derivative portfolio unavailable');
      if(!historyResponse.ok)throw new Error(history.error||'Derivative order history unavailable');
      body.textContent='';
      if(!data.positions?.length)tableMessage(body,6,'No open derivative positions.');
      else data.positions.forEach(p=>{
        const tr=document.createElement('tr');
        [p.instrumentKey,p.netQuantity,inrPaise(p.averagePricePaise),inrPaise(p.marketPricePaise),inrPaise(Math.abs(p.marketValuePaise)),signedMoney(p.unrealizedPnlPaise)].forEach(v=>{const td=document.createElement('td');td.textContent=String(v);tr.append(td);});
        body.append(tr);
      });
      status.textContent=data.valuationStatus==='fresh'?'Long CE/PE positions · Fresh Upstox quotes · Entry charges included; exit charges excluded':'No open derivative positions';
      const historyBody=document.getElementById('derivative-history');
      if(historyBody){
        historyBody.textContent='';
        if(!history.orders?.length)tableMessage(historyBody,6,'No derivative orders yet.');
        else history.orders.forEach(order=>{
          const tr=document.createElement('tr'),date=order.createdAt?new Date(order.createdAt).toLocaleString('en-IN'):'—';
          [date,order.tradingSymbol,order.side,order.lots,inrPaise(order.grossPaise),order.status+' · fees '+inrPaise(order.chargesPaise)+' · SIM'].forEach(v=>{const td=document.createElement('td');td.textContent=String(v);tr.append(td);});
          historyBody.append(tr);
        });
      }
    }catch(error){if(request===derivativePortfolioRequest&&connector.getUserId()===uid)status.textContent=error.message||'Derivative valuation unavailable';}
  }
  let futuresPortfolioRequest=0;
  async function loadFuturesPortfolio(){
    const connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.(),request=++futuresPortfolioRequest;
    const body=document.getElementById('futures-positions'),historyBody=document.getElementById('futures-history'),status=document.getElementById('futures-portfolio-status');
    if(!body||!historyBody||!status||!gateway||!connector?.getIdToken||!uid)return;
    try{
      const token=await connector.getIdToken();
      if(request!==futuresPortfolioRequest||connector.getUserId()!==uid)return;
      const [response,historyResponse]=await Promise.all([
        fetch(gateway+'/paper/futures/portfolio',{headers:{Authorization:'Bearer '+token,Accept:'application/json'}}),
        fetch(gateway+'/paper/futures/orders?limit=50',{headers:{Authorization:'Bearer '+token,Accept:'application/json'}})
      ]);
      const data=await response.json(),history=await historyResponse.json();
      if(request!==futuresPortfolioRequest||connector.getUserId()!==uid)return;
      if(!response.ok)throw new Error(data.error||'Futures portfolio unavailable');
      if(!historyResponse.ok)throw new Error(history.error||'Futures order history unavailable');
      body.textContent='';
      if(!data.positions?.length)tableMessage(body,7,'No open futures positions.');
      else data.positions.forEach(p=>{
        const tr=document.createElement('tr');
        [p.tradingSymbol||p.instrumentKey,p.product,p.netQuantity,inrPaise(p.averagePricePaise),p.marketPricePaise==null?'STALE':inrPaise(p.marketPricePaise),p.unrealizedPnlPaise==null?'—':signedMoney(p.unrealizedPnlPaise),inrPaise(p.marginReservedPaise)].forEach(v=>{const td=document.createElement('td');td.textContent=String(v);tr.append(td);});
        body.append(tr);
      });
      status.textContent=data.stalePositions>0?'Stale/unavailable quotes for '+data.stalePositions+' of '+data.positions.length+' futures positions. Aggregate unrealized P&L and equity are withheld until every quote is fresh. Margin shown is the entry reservation estimate.':data.marginStatus==='entry_estimate'?'Fresh futures quotes · Margin shown is the entry reservation estimate.':'No open futures positions.';
      historyBody.textContent='';
      if(!history.orders?.length)tableMessage(historyBody,8,'No futures orders yet.');
      else history.orders.forEach(order=>{
        const tr=document.createElement('tr'),date=order.createdAt?new Date(order.createdAt).toLocaleString('en-IN'):'—';
        [date,order.tradingSymbol,order.side,order.product,order.quantity/order.lotSize,inrPaise(order.executionPricePaise),inrPaise(order.chargesPaise),order.status+' · SIM'].forEach(v=>{const td=document.createElement('td');td.textContent=String(v);tr.append(td);});
        historyBody.append(tr);
      });
    }catch(error){if(request===futuresPortfolioRequest&&connector.getUserId()===uid)status.textContent=error.message||'Futures portfolio unavailable';}
  }
  async function refreshPaperViews(){await Promise.all([loadPaperPortfolio(),loadPaperHistory(),loadDerivativePortfolio(),loadFuturesPortfolio()]);}
  paperRefresh.addEventListener('click',refreshPaperViews);

  let paperOrderSubmitting=false,paperOrderSubmitSeq=0;
  function updatePaperButtons(){
    const allowed=!paperOrderSubmitting&&!!selected&&['NSE_EQ','BSE_EQ'].includes(selected.segment)&&selected.instrument_type==='EQ'&&!!window.ZENURA_MARKET_CONNECTOR?.getIdToken&&!!window.ZENURA_MARKET_CONNECTOR?.getUserId?.()&&!!gateway;
    paperBuy.disabled=!allowed;paperSell.disabled=!allowed;updateProtectiveButton?.();
  }
  const pendingOrderStorage=(()=>{try{return window.localStorage;}catch(_){return null;}})();
  const paperPendingStorageKey='zenura-indian-paper-order-pending-v1';
  const derivativePendingStorageKey='zenura-indian-derivative-order-pending-v1';
  const retryPolicy=window.ZenuraPaperOrderRetryPolicy;
  async function submitPaperOrder(side){
    if(paperOrderSubmitting)return;
    const qty=Number(paperQuantity.value);
    if(!Number.isSafeInteger(qty)||qty<1||qty>1000000){paperOrderStatus.textContent='Enter a whole-number quantity between 1 and 1,000,000.';return;}
    if(!selected||!['NSE_EQ','BSE_EQ'].includes(selected.segment)||selected.instrument_type!=='EQ'){paperOrderStatus.textContent='Select an NSE/BSE cash equity first.';return;}
    const connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.();
    if(!uid||!connector?.getIdToken){paperOrderStatus.textContent='Sign in before placing a paper order.';return;}
    const storageKey=retryPolicy.userScopedStorageKey(paperPendingStorageKey,uid);
    if(!storageKey){paperOrderStatus.textContent='Could not identify the signed-in account. Please sign in again.';return;}
    const legacy=retryPolicy.inspectLegacyPendingPaperOrder(pendingOrderStorage,paperPendingStorageKey,uid,storageKey);
    if(legacy.state==='ambiguous'){paperOrderStatus.textContent='A legacy pending order from an earlier version cannot be safely attributed to this account. No retry was sent. Review this account’s paper order history before continuing.';return;}
    if(legacy.state==='unavailable'){paperOrderStatus.textContent='Legacy pending-order recovery could not be verified. No order was sent; retry after browser storage is available.';return;}
    const pending=retryPolicy.readPendingPaperOrder(pendingOrderStorage,storageKey);
    let pendingKey=pending?.key||null;
    const instrumentKey=selected.instrument_key,tradingSymbol=selected.trading_symbol||selected.name||selected.instrument_key;
    const product=paperProductMode?.value==='INTRADAY'?'INTRADAY':'DELIVERY';
    const fingerprintPayload={instrument_key:instrumentKey,side,quantity:qty};if(product==='INTRADAY')fingerprintPayload.product=product;
    const fingerprint=JSON.stringify(fingerprintPayload);
    if(pendingKey&&!retryPolicy.canRetryPendingPaperOrder(pending.fingerprint,fingerprint)){
      paperOrderStatus.textContent='A previous order response is uncertain for this account. Retry the same stock, side and quantity first.';return;
    }
    if(!pendingKey){
      if(!window.crypto?.randomUUID){paperOrderStatus.textContent='A secure order request ID could not be created in this browser.';return;}
      pendingKey=window.crypto.randomUUID();
      if(!retryPolicy.writePendingPaperOrder(pendingOrderStorage,storageKey,{key:pendingKey,fingerprint})){
        paperOrderStatus.textContent='Browser storage is unavailable. The order was not sent because safe retry protection could not be saved.';
        return;
      }
    }
    paperOrderSubmitting=true;const submitSeq=++paperOrderSubmitSeq;updatePaperButtons();paperOrderStatus.textContent='Verifying fresh provider quote and processing simulated order…';
    try{
      const token=await connector.getIdToken();
      if(connector.getUserId()!==uid)throw new Error('Account changed. Sign back into the original account to safely verify this pending order.');
      const response=await fetch(gateway+'/paper/orders',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({instrument_key:instrumentKey,side,quantity:qty,product,idempotency_key:pendingKey})});
      const data=await response.json().catch(()=>({}));
      if(connector.getUserId()!==uid)throw new Error('Account changed while the order was processing. Sign back into the original account to verify its result.');
      if(!response.ok){if(response.status>=400&&response.status<500)retryPolicy.clearPendingPaperOrder(pendingOrderStorage,storageKey);throw new Error(data.error||'Paper order rejected');}
      if(typeof data.orderId!=='string'||!Number.isSafeInteger(data.executionPricePaise)||data.executionPricePaise<1)
        throw new Error('Order response could not be verified. Retry the same order to safely check its result.');
      retryPolicy.clearPendingPaperOrder(pendingOrderStorage,storageKey);
      const fillMessage=side+' '+qty+' '+(data.tradingSymbol||tradingSymbol)+' filled at '+inrPaise(data.executionPricePaise)+' · Simulated only';
      paperOrderStatus.textContent=fillMessage;
      try{await loadPaperAccount();await refreshPaperViews();}
      catch(refreshError){if(connector.getUserId()===uid)paperOrderStatus.textContent=fillMessage+' Portfolio refresh failed; use Refresh to reload balances.';}
    }catch(error){if(connector.getUserId()===uid)paperOrderStatus.textContent=error.message||'Paper order failed.';}
    finally{if(submitSeq===paperOrderSubmitSeq){paperOrderSubmitting=false;updatePaperButtons();}}
  }
  paperBuy.addEventListener('click',()=>submitPaperOrder('BUY'));
  paperSell.addEventListener('click',()=>submitPaperOrder('SELL'));
  const protectiveCreate=document.getElementById('paper-protective-create');
  const protectiveType=document.getElementById('paper-protective-type');
  const protectivePrice=document.getElementById('paper-protective-price');
  const protectiveStatus=document.getElementById('paper-protective-status');
  const protectiveListStatus=document.getElementById('paper-protective-list-status');
  const protectiveBody=document.getElementById('paper-protective-orders-body');
  const protectiveRefresh=document.getElementById('paper-protective-refresh');
  let protectiveWorkerEnabled=false,protectiveSubmitting=false,protectiveLoadSeq=0;
  function updateProtectiveButton(){
    const allowed=!protectiveSubmitting&&protectiveWorkerEnabled&&!!selected
      &&['NSE_EQ','BSE_EQ'].includes(selected.segment)&&selected.instrument_type==='EQ'
      &&!!window.ZENURA_MARKET_CONNECTOR?.getIdToken&&!!window.ZENURA_MARKET_CONNECTOR?.getUserId?.()&&!!gateway;
    if(protectiveCreate)protectiveCreate.disabled=!allowed;
    if(protectivePrice)protectivePrice.disabled=!allowed;
  }
  function protectiveTime(value){
    const ms=Date.parse(value||'');return Number.isFinite(ms)?new Date(ms).toLocaleString('en-IN'):'—';
  }
  async function loadProtectiveOrders(){
    const connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.(),request=++protectiveLoadSeq;
    if(!gateway||!connector?.getIdToken||!uid){protectiveWorkerEnabled=false;updateProtectiveButton();return;}
    protectiveListStatus.textContent='Loading your private protective orders…';
    try{
      const token=await connector.getIdToken();
      if(request!==protectiveLoadSeq||connector.getUserId()!==uid)return;
      const response=await fetch(gateway+'/paper/protective-orders?limit=100',{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      const data=await response.json().catch(()=>({}));
      if(request!==protectiveLoadSeq||connector.getUserId()!==uid)return;
      if(!response.ok)throw new Error(data.error||'Protective orders could not be loaded.');
      protectiveWorkerEnabled=data.workerEnabled===true;updateProtectiveButton();
      protectiveBody.textContent='';
      const orders=data.orders||[];
      if(!orders.length)tableMessage(protectiveBody,8,'No protective orders yet.');
      orders.forEach(order=>{
        const tr=document.createElement('tr');
        const instrument=items.find(x=>x.instrument_key===order.instrumentKey);
        const values=[protectiveTime(order.createdAt),instrument?.trading_symbol||order.instrumentKey,order.product,
          order.triggerType,order.quantity,inrPaise(order.triggerPricePaise),order.status];
        values.forEach(value=>{const td=document.createElement('td');td.textContent=String(value);tr.append(td);});
        const action=document.createElement('td');
        if(['ACTIVE','TRIGGERED'].includes(order.status)){
          const cancel=document.createElement('button');cancel.type='button';cancel.textContent='CANCEL';
          cancel.addEventListener('click',()=>cancelProtectiveOrder(order.orderId));action.append(cancel);
        }else action.textContent=order.executionPricePaise?('Filled '+inrPaise(order.executionPricePaise)):'—';
        tr.append(action);protectiveBody.append(tr);
      });
      protectiveListStatus.textContent=protectiveWorkerEnabled
        ?'Equity protective worker is enabled. Orders are simulated; share quantity is rechecked at execution and is not reserved.'
        :'Protective execution is disabled on this gateway. No new protective exits can be created.';
      protectiveStatus.textContent=protectiveWorkerEnabled
        ?'NSE/BSE cash equities only · SELL-to-close · Simulated execution.'
        :'Protective execution is not enabled on this gateway.';
    }catch(error){
      if(request===protectiveLoadSeq&&connector.getUserId()===uid){
        protectiveWorkerEnabled=false;updateProtectiveButton();
        protectiveListStatus.textContent=error.message||'Protective order list unavailable.';
        protectiveStatus.textContent=protectiveListStatus.textContent;
      }
    }
  }
  async function submitProtectiveOrder(){
    if(protectiveSubmitting||!protectiveWorkerEnabled||!selected)return;
    const connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.();
    if(!uid||!connector?.getIdToken)return;
    const quantity=Number(paperQuantity.value),priceRupees=Number(protectivePrice.value);
    const triggerPricePaise=Math.round(priceRupees*100),product=paperProductMode.value==='INTRADAY'?'INTRADAY':'DELIVERY';
    const triggerType=protectiveType.value;
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000){protectiveStatus.textContent='Enter a valid whole-number exit quantity.';return;}
    if(!Number.isFinite(priceRupees)||!Number.isSafeInteger(triggerPricePaise)||triggerPricePaise<1){protectiveStatus.textContent='Enter a valid trigger price in rupees.';return;}
    if(!['NSE_EQ','BSE_EQ'].includes(selected.segment)||selected.instrument_type!=='EQ'){protectiveStatus.textContent='Select an NSE/BSE cash equity first.';return;}
    if(!window.crypto?.randomUUID){protectiveStatus.textContent='Secure order identity is unavailable in this browser.';return;}
    protectiveSubmitting=true;updateProtectiveButton();protectiveStatus.textContent='Validating held shares and creating the simulated protective exit…';
    const instrumentKey=selected.instrument_key,orderId=window.crypto.randomUUID();
    try{
      const token=await connector.getIdToken();
      if(connector.getUserId()!==uid||selected?.instrument_key!==instrumentKey)throw new Error('Account or selected instrument changed. Retry from the intended account and stock.');
      const response=await fetch(gateway+'/paper/protective-orders',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify({order_id:orderId,instrument_key:instrumentKey,product,trigger_type:triggerType,trigger_price_paise:triggerPricePaise,quantity})});
      const data=await response.json().catch(()=>({}));
      if(connector.getUserId()!==uid)throw new Error('Account changed while the protective order was processing.');
      if(!response.ok)throw new Error(data.error||'Protective order rejected.');
      protectiveStatus.textContent=(data.idempotentReplay?'Verified existing':'Created')+' '+triggerType+' for '+quantity+' '+(data.tradingSymbol||instrumentKey)+' at '+inrPaise(triggerPricePaise)+'. Simulation only.';
      await loadProtectiveOrders();
    }catch(error){if(connector.getUserId()===uid)protectiveStatus.textContent=error.message||'Protective order could not be created.';}
    finally{protectiveSubmitting=false;updateProtectiveButton();}
  }
  async function cancelProtectiveOrder(orderId){
    const connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.();
    if(!uid||!connector?.getIdToken)return;
    try{
      const token=await connector.getIdToken();
      if(connector.getUserId()!==uid)return;
      const response=await fetch(gateway+'/paper/protective-orders/'+encodeURIComponent(orderId)+'/cancel',{method:'POST',headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'Protective cancellation failed.');
      protectiveStatus.textContent=data.alreadyFilled?'Order was already filled; its execution remains recorded.':data.cancelled?'Protective order cancelled.':'Protective order status: '+data.status+'.';
      await loadProtectiveOrders();
    }catch(error){if(connector.getUserId()===uid)protectiveStatus.textContent=error.message||'Protective cancellation failed.';}
  }
  protectiveCreate?.addEventListener('click',submitProtectiveOrder);
  protectiveRefresh?.addEventListener('click',loadProtectiveOrders);
  if(paperQuantity)paperQuantity.addEventListener('input',updateProtectiveButton);
  if(paperProductMode)paperProductMode.addEventListener('change',updateProtectiveButton);


  const futuresMarginButton=document.getElementById('futures-margin-preview');
  const futuresMarginLots=document.getElementById('futures-margin-lots');
  const futuresMarginSide=document.getElementById('futures-margin-side');
  const futuresMarginProduct=document.getElementById('futures-margin-product');
  const futuresMarginStatus=document.getElementById('futures-margin-status');
  let futuresOrderSubmitting=false;
  function updateFuturesOrderButtons(){
    const enabled=!futuresOrderSubmitting&&!!selected&&selected.instrument_type==='FUT'
      &&['NSE_FO','BSE_FO'].includes(selected.segment)
      &&!!window.ZENURA_MARKET_CONNECTOR?.getUserId?.()&&!!gateway;
    const buy=document.getElementById('futures-order-buy'),sell=document.getElementById('futures-order-sell');
    if(buy)buy.disabled=!enabled;if(sell)sell.disabled=!enabled;
  }
  async function submitFuturesOrder(side){
    if(futuresOrderSubmitting)return;
    if(!selected||selected.instrument_type!=='FUT'){futuresOrderStatus.textContent='Select a verified futures contract first.';return;}
    const instrumentKey=selected.instrument_key,tradingSymbol=selected.trading_symbol||selected.name||selected.instrument_key;
    const lots=Number(futuresOrderLots.value),product=futuresOrderProduct.value;
    if(!Number.isSafeInteger(lots)||lots<1||lots>10000){futuresOrderStatus.textContent='Enter whole lots from 1 to 10,000.';return;}
    const connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.();
    if(!uid||!connector?.getIdToken){futuresOrderStatus.textContent='Sign in before placing a futures paper order.';return;}
    const storageKey=retryPolicy.userScopedStorageKey(futuresPendingStorageKey,uid);
    if(!storageKey){futuresOrderStatus.textContent='Could not identify the signed-in account.';return;}
    const fingerprint=JSON.stringify({instrument_key:instrumentKey,side,lots,product});
    const pending=retryPolicy.readPendingPaperOrder(pendingOrderStorage,storageKey);
    let key=pending?.key||null;
    if(key&&!retryPolicy.canRetryPendingPaperOrder(pending.fingerprint,fingerprint)){
      futuresOrderStatus.textContent='A previous futures order response is uncertain. Retry the same contract, side, lots and product first.';return;
    }
    if(!key){
      if(!window.crypto?.randomUUID){futuresOrderStatus.textContent='Secure request ID is unavailable.';return;}
      key=window.crypto.randomUUID();
      if(!retryPolicy.writePendingPaperOrder(pendingOrderStorage,storageKey,{key,fingerprint})){
        futuresOrderStatus.textContent='Safe order retry storage is unavailable. No order was sent.';return;
      }
    }
    futuresOrderSubmitting=true;updateFuturesOrderButtons();
    futuresOrderStatus.textContent='Verifying fresh futures quote and Upstox margin…';
    try{
      const token=await connector.getIdToken();
      if(connector.getUserId()!==uid)throw new Error('Account changed. Sign back into the original account to verify this order.');
      if(selected?.instrument_key!==instrumentKey)throw new Error('Selected futures contract changed. Re-submit the order for the intended contract.');
      const response=await fetch(gateway+'/paper/futures/orders',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({instrument_key:instrumentKey,side,lots,product,order_type:'MARKET',idempotency_key:key})});
      const data=await response.json().catch(()=>({}));
      if(connector.getUserId()!==uid)throw new Error('Account changed while the futures order was processing.');
      if(!response.ok){if(response.status>=400&&response.status<500)retryPolicy.clearPendingPaperOrder(pendingOrderStorage,storageKey);throw new Error(data.error||'Futures paper order rejected.');}
      if(typeof data.orderId!=='string'||!Number.isSafeInteger(data.executionPricePaise)||data.executionPricePaise<1)throw new Error('Order response could not be verified. Retry the same order to safely check its result.');
      retryPolicy.clearPendingPaperOrder(pendingOrderStorage,storageKey);
      futuresOrderStatus.textContent=side+' '+lots+' lot(s) · '+(data.tradingSymbol||tradingSymbol)+' filled at '+inrPaise(data.executionPricePaise)+' · Charges '+inrPaise(data.chargesPaise)+' · Conservative order-quantity margin estimate '+inrPaise(data.openingMarginPaise)+' · SIM';
      await loadPaperAccount();await refreshPaperViews();
    }catch(error){if(connector.getUserId()===uid)futuresOrderStatus.textContent=error.message||'Futures order failed.';}
    finally{futuresOrderSubmitting=false;updateFuturesOrderButtons();}
  }
  const futuresOrderLots=document.getElementById('futures-order-lots');
  const futuresOrderProduct=document.getElementById('futures-order-product');
  const futuresOrderStatus=document.getElementById('futures-order-status');
  const futuresPendingStorageKey='zenura-futures-paper-order-pending-v1';
  document.getElementById('futures-order-buy')?.addEventListener('click',()=>submitFuturesOrder('BUY'));
  document.getElementById('futures-order-sell')?.addEventListener('click',()=>submitFuturesOrder('SELL'));
  function updateFuturesMarginButton(){
    const signedIn=!!window.ZENURA_MARKET_CONNECTOR?.getUserId?.();
    if(futuresMarginButton)futuresMarginButton.disabled=!signedIn||!gateway||!selected||selected.instrument_type!=='FUT';
    updateFuturesOrderButtons();
    if(futuresMarginStatus&&!signedIn)futuresMarginStatus.textContent='Sign in to request broker margin preview.';
    else if(futuresMarginStatus&&(!selected||selected.instrument_type!=='FUT'))futuresMarginStatus.textContent='Select a verified futures contract from the Futures watchlist.';
  }
  let futuresMarginRequest=0;
  async function requestFuturesMarginPreview(){
    if(!selected||selected.instrument_type!=='FUT'){futuresMarginStatus.textContent='Choose a futures contract first.';return;}
    const lots=Number(futuresMarginLots.value),side=futuresMarginSide.value,product=futuresMarginProduct.value;
    if(!Number.isSafeInteger(lots)||lots<1||lots>10000){futuresMarginStatus.textContent='Enter whole lots from 1 to 10,000.';return;}
    const connector=window.ZENURA_MARKET_CONNECTOR;
    if(!gateway||!connector?.getIdToken){futuresMarginStatus.textContent='Sign in and connect Upstox to request broker margin.';return;}
    const instrumentKey=selected.instrument_key,uid=connector.getUserId?.(),request=++futuresMarginRequest;
    if(!uid){futuresMarginStatus.textContent='Sign in before requesting broker margin.';return;}
    futuresMarginButton.disabled=true;futuresMarginStatus.textContent='Fetching fresh futures quote and Upstox margin estimate…';
    try{
      const token=await connector.getIdToken();
      if(request!==futuresMarginRequest||connector.getUserId()!==uid||selected?.instrument_key!==instrumentKey)return;
      const response=await fetch(gateway+'/paper/derivative/margin-preview',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({instrument_key:instrumentKey,lots,side,product})});
      const data=await response.json();
      if(!response.ok){
        const retryAfter=Number.parseInt(response.headers.get('Retry-After')||'',10);
        const message=response.status===429&&Number.isSafeInteger(retryAfter)&&retryAfter>0
          ?'Please wait '+retryAfter+' second(s) before requesting another margin preview.'
          :(data.error||'Broker margin preview failed.');
        throw new Error(message);
      }
      if(request!==futuresMarginRequest||connector.getUserId()!==uid||selected?.instrument_key!==instrumentKey)return;
      const required=inrPaise(data.requiredMarginPaise),cash=inrPaise(data.availableVirtualCashPaise),shortfall=inrPaise(data.shortfallPaise);
      const finalText=data.finalMarginPaise===null?'':' · Final margin '+inrPaise(data.finalMarginPaise);
      const quoteText=data.quote?.pricePaise?' · Quote '+inrPaise(data.quote.pricePaise):'';
      const components=data.marginComponents?.[0]||{};
      const componentText=[['SPAN',components.spanPaise],['Exposure',components.exposurePaise],['Option premium',components.optionPremiumPaise],['Net buy premium',components.netBuyPremiumPaise],['Tender',components.tenderPaise],['Delivery',components.deliveryPaise],['Total margin',components.totalMarginPaise]]
        .filter(([,value])=>Number.isSafeInteger(value)).map(([label,value])=>label+' '+inrPaise(value)).join(' · ');
      futuresMarginStatus.textContent='PREVIEW ONLY · '+data.tradingSymbol+' · '+side+' '+lots+' lot(s) / '+data.quantity+' qty · '+(product==='I'?'Intraday':'Delivery')+' margin'+quoteText+' · Required margin '+required+finalText+(componentText?' · '+componentText:'')+' · Virtual cash '+cash+' · Shortfall '+shortfall+'. No order placed; no funds reserved.';
    }catch(error){if(request===futuresMarginRequest&&connector.getUserId()===uid&&selected?.instrument_key===instrumentKey)futuresMarginStatus.textContent=error.message||'Futures margin preview failed.';}
    finally{if(request===futuresMarginRequest)updateFuturesMarginButton();}
  }
  futuresMarginButton?.addEventListener('click',requestFuturesMarginPreview);
  const optionExpiry=document.getElementById('option-expiry');
  const optionButton=document.getElementById('load-option-chain');
  const optionStatus=document.getElementById('option-status');
  const optionBody=document.getElementById('option-chain-body');
  function cellValue(value){return value===null||value===undefined?'—':Number.isFinite(Number(value))?Number(value).toLocaleString('en-IN',{maximumFractionDigits:2}):String(value);}
  function renderOptionChain(rows){
    optionBody.textContent='';
    if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=11;td.className='option-empty';td.textContent='No option contracts returned for this expiry.';tr.append(td);optionBody.append(tr);return;}
    rows.forEach(row=>{
      const ce=row.call_options||{},pe=row.put_options||{},cm=ce.market_data||{},pm=pe.market_data||{},cg=ce.option_greeks||{},pg=pe.option_greeks||{};
      const tr=document.createElement('tr');
      [cm.ltp,cm.oi,cm.volume,cg.iv,cg.delta,row.strike_price,pg.delta,pg.iv,pm.volume,pm.oi,pm.ltp].forEach((v,i)=>{const td=document.createElement('td');td.textContent=cellValue(v);if(i===5)td.className='strike-cell';tr.append(td);});
      [[0,ce,'CE'],[10,pe,'PE']].forEach(([index,contract,type])=>{if(typeof contract.instrument_key!=='string'||!contract.instrument_key)return;const td=tr.children[index];['BUY','SELL'].forEach(side=>{const button=document.createElement('button');button.type='button';button.className='option-buy-button '+(side==='SELL'?'option-sell-button':'');button.textContent=side+' '+type;button.addEventListener('click',()=>submitDerivativeOrder(contract.instrument_key,type,row.strike_price,side));td.append(document.createTextNode(' '),button);});});
      optionBody.append(tr);
    });
  }
  let optionChainRequest=0;
  function resetOptionChain(message){
    optionChainRequest++;
    optionButton.disabled=false;
    optionBody.textContent='';
    const tr=document.createElement('tr'),td=document.createElement('td');
    td.colSpan=11;td.className='option-empty';td.textContent='Choose an underlying instrument and load a real option chain.';
    tr.append(td);optionBody.append(tr);
    optionStatus.textContent=message;
  }
  optionExpiry.addEventListener('change',()=>resetOptionChain('Expiry changed. Reload the option chain for the selected expiry.'));
  async function loadOptionChain(){
    if(!selected){optionStatus.textContent='Select an underlying instrument first';return;}
    if(!['NSE_INDEX','BSE_INDEX','NSE_EQ','BSE_EQ'].includes(selected.segment)){optionStatus.textContent='Option chain requires an NSE/BSE index or cash-equity underlying, not an option or futures contract.';return;}
    const connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.();
    if(!gateway||!connector?.getIdToken||!uid){optionStatus.textContent='Sign in and configure the market gateway first';return;}
    const request=++optionChainRequest,instrumentKey=selected.instrument_key,expiry=optionExpiry.value;
    optionButton.disabled=true;optionStatus.textContent='Loading official Upstox option chain…';
    try{
      const token=await connector.getIdToken();
      if(request!==optionChainRequest||connector.getUserId()!==uid||selected?.instrument_key!==instrumentKey||optionExpiry.value!==expiry)return;
      const params=new URLSearchParams({instrument_key:instrumentKey,expiry_date:expiry});
      const response=await fetch(gateway+'/option-chain?'+params,{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      if(!response.ok)throw new Error('Option chain unavailable ('+response.status+').');
      const payload=await response.json();
      if(request!==optionChainRequest||connector.getUserId()!==uid||selected?.instrument_key!==instrumentKey||optionExpiry.value!==expiry)return;
      renderOptionChain(payload.data||[]);
      optionStatus.textContent='Provider response · '+(payload.data?.length||0)+' strikes · '+expiry;
    }catch(error){if(request===optionChainRequest&&connector.getUserId()===uid&&selected?.instrument_key===instrumentKey&&optionExpiry.value===expiry)optionStatus.textContent=error.message||'Option chain request failed.';}
    finally{if(request===optionChainRequest)optionButton.disabled=false;}
  }
  let derivativeOrderSubmitting=false,derivativeOrderSubmitSeq=0;
  async function submitDerivativeOrder(instrumentKey,type,strike,side='BUY'){
    if(derivativeOrderSubmitting)return;
    const connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.(),chainRequest=optionChainRequest,underlyingKey=selected?.instrument_key,expiry=optionExpiry.value;
    if(!gateway||!connector?.getIdToken||!uid||!underlyingKey){optionStatus.textContent='Sign in and connect Upstox before placing a paper order.';return;}
    const lotsRaw=window.prompt('Number of '+type+' lots to '+side.toLowerCase()+' (market paper order):','1');
    if(lotsRaw===null)return;
    if(connector.getUserId()!==uid||optionChainRequest!==chainRequest||selected?.instrument_key!==underlyingKey||optionExpiry.value!==expiry){optionStatus.textContent='Account, expiry or selected option chain changed. Reload the option chain before placing an order.';return;}
    const lots=Number(lotsRaw);
    if(!Number.isSafeInteger(lots)||lots<1||lots>10000){optionStatus.textContent='Enter a whole number of lots from 1 to 10,000.';return;}
    if(!window.crypto?.randomUUID){optionStatus.textContent='A secure order request ID could not be created in this browser.';return;}
    const storageKey=retryPolicy.userScopedStorageKey(derivativePendingStorageKey,uid);
    if(!storageKey){optionStatus.textContent='Could not identify the signed-in account. Please sign in again.';return;}
    const legacy=retryPolicy.inspectLegacyPendingPaperOrder(pendingOrderStorage,derivativePendingStorageKey,uid,storageKey);
    if(legacy.state==='ambiguous'){optionStatus.textContent='A legacy option order from an earlier version cannot be safely attributed to this account. No retry was sent. Review this account’s derivative order history before continuing.';return;}
    if(legacy.state==='unavailable'){optionStatus.textContent='Legacy option-order recovery could not be verified. No order was sent; retry after browser storage is available.';return;}
    const pending=retryPolicy.readPendingPaperOrder(pendingOrderStorage,storageKey);
    const fingerprint=instrumentKey+'|'+side+'|'+lots;
    if(pending&&pending.fingerprint!==fingerprint){optionStatus.textContent='A previous option order response is uncertain for this account. Retry the same contract and lot quantity first.';return;}
    const pendingKey=pending?.key||window.crypto.randomUUID();
    if(!pending&&!retryPolicy.writePendingPaperOrder(pendingOrderStorage,storageKey,{fingerprint,key:pendingKey})){
      optionStatus.textContent='Browser session storage is unavailable. The option order was not sent because safe retry protection could not be saved.';
      return;
    }
    derivativeOrderSubmitting=true;const submitSeq=++derivativeOrderSubmitSeq;optionButton.disabled=true;optionStatus.textContent='Verifying live option quote and placing simulated '+type+' '+side+'…';
    try{
      const token=await connector.getIdToken();
      if(connector.getUserId()!==uid)throw new Error('Account changed. Sign back into the original account to safely verify this pending option order.');
      const response=await fetch(gateway+'/paper/derivative/orders',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({instrument_key:instrumentKey,side,lots,idempotency_key:pendingKey})});
      const data=await response.json();
      if(connector.getUserId()!==uid)throw new Error('Account changed while the option order was processing. Sign back into the original account to verify its result.');
      if(!response.ok){if(response.status>=400&&response.status<500)retryPolicy.clearPendingPaperOrder(pendingOrderStorage,storageKey);throw new Error(data.error||'Derivative paper order rejected.');}
      if(typeof data.orderId!=='string'||!Number.isSafeInteger(data.quantity)||data.quantity<1||
         !Number.isSafeInteger(data.executionPricePaise)||data.executionPricePaise<1)
        throw new Error('Option order response could not be verified. Retry the same order to safely check its result.');
      retryPolicy.clearPendingPaperOrder(pendingOrderStorage,storageKey);
      const fillMessage='SIMULATED '+side+' FILLED · '+data.tradingSymbol+' · '+data.quantity+' units · Premium '+inrPaise(data.grossPaise)+' · Estimated charges '+inrPaise(data.chargesPaise)+' · '+(side==='BUY'?'Total debit '+inrPaise(data.totalDebitPaise):'Net proceeds '+inrPaise(data.netCreditPaise))+'.';
      optionStatus.textContent=fillMessage;
      try{await loadPaperAccount();await refreshPaperViews();}
      catch(refreshError){if(connector.getUserId()===uid)optionStatus.textContent=fillMessage+' Portfolio refresh failed; use Refresh to reload balances.';}
    }catch(error){if(connector.getUserId()===uid)optionStatus.textContent=error.message||'Derivative paper order failed.';}
    finally{if(submitSeq===derivativeOrderSubmitSeq){derivativeOrderSubmitting=false;if(connector.getUserId()===uid&&optionChainRequest===chainRequest)optionButton.disabled=false;}}
  }
  optionButton.addEventListener('click',loadOptionChain);

  const chart=document.getElementById('market-chart');
  const chartStatus=document.getElementById('chart-status');
  const timeframeButtons=[...document.querySelectorAll('[data-timeframe]')];
  let activeTimeframe='1m',chartRequest=0;
  const frames={'1m':['minutes',1,7],'5m':['minutes',5,14],'15m':['minutes',15,30],'1h':['hours',1,90],'1D':['days',1,365]};
  function localDate(offset=0){
    const d=new Date();d.setDate(d.getDate()+offset);
    return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  }
  async function loadCandles(){
    if(!selected||!gateway)return;
    const connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.();
    if(!connector?.getIdToken||!uid){chartStatus.textContent='Sign in to load historical candles';return;}
    const request=++chartRequest,instrument={...selected},timeframe=activeTimeframe;
    chart.textContent='';
    const loading=document.createElement('b');loading.textContent='Loading professional chart…';chart.append(loading);
    chartStatus.textContent='Starting KLineChart 10.1.1';
    try{
      const engine=window.ZenuraProfessionalChart;
      if(!engine)throw new Error('Professional chart engine is not available. Reload the page and retry.');
      await engine.mount({
        container:chart,instrument,timeframe,gateway,
        getAccessToken:()=>connector.getIdToken(),
        supabase:window.ZENURA_SUPABASE,
        onTimeframeChange:next=>{
          activeTimeframe=next;
          timeframeButtons.forEach(button=>button.classList.toggle('active',button.dataset.timeframe===next));
        },
        onError:error=>{
          if(request===chartRequest&&connector.getUserId()===uid&&selected?.instrument_key===instrument.instrument_key){
            chartStatus.textContent='Historical data unavailable';
            const status=document.createElement('span');status.className='chart-engine-error';status.textContent=error?.message||'Could not load historical candles.';
            if(!chart.querySelector('.chart-engine-error'))chart.append(status);
          }
        }
      });
      if(request!==chartRequest||connector.getUserId()!==uid||selected?.instrument_key!==instrument.instrument_key)return;
      chartStatus.textContent='Professional chart · Upstox V3 · '+timeframe;
    }catch(error){
      if(request!==chartRequest||connector.getUserId()!==uid)return;
      chart.textContent='';
      const b=document.createElement('b');b.textContent='Chart data unavailable';
      const span=document.createElement('span');span.textContent=error.message||'Could not load historical candles.';
      chart.append(b,span);chartStatus.textContent='Not connected';
    }
  }
  timeframeButtons.forEach(button=>button.addEventListener('click',()=>{activeTimeframe=button.dataset.timeframe;timeframeButtons.forEach(x=>x.classList.toggle('active',x===button));loadCandles();}));
  function setFeedStatus(heading,message){const h=document.querySelector('.chart-placeholder b'),s=document.querySelector('.chart-placeholder span');if(h)h.textContent=heading;if(s)s.textContent=message;}
  function scheduleReconnect(item,uid){
    const connector=window.ZENURA_MARKET_CONNECTOR;
    if(!uid||connector?.getUserId?.()!==uid||selected?.instrument_key!==item.instrument_key||reconnectTimer)return;
    const retry=window.ZenuraReconnectPolicy.nextReconnectDelay(reconnectAttempt);reconnectAttempt=retry.nextAttempt;
    const delay=window.ZenuraReconnectPolicy.jitteredReconnectDelay(retry.delayMs)??retry.delayMs;
    setFeedStatus('Live feed disconnected','Reconnecting in '+Math.round(delay/1000)+'s…');
    reconnectTimer=setTimeout(()=>{reconnectTimer=null;if(connector?.getUserId?.()===uid&&selected?.instrument_key===item.instrument_key)select(item,true);},delay);
  }
  async function select(item,isReconnect=false){
    const connector=window.ZENURA_MARKET_CONNECTOR,uid=connector?.getUserId?.();
    clearFeedTimers();
    if(streamAbort){streamAbort.abort();streamAbort=null;}
    selected=item;window.dispatchEvent(new CustomEvent('zenura:instrument-selected',{detail:{instrument:item}}));if(!isReconnect)resetOptionChain('Underlying changed. Load the option chain for the selected instrument.');if(futuresMarginStatus)futuresMarginStatus.textContent=item.instrument_type==='FUT'?'Selected '+(item.trading_symbol||'futures contract')+'. Request a fresh broker margin preview.':'Select a verified futures contract from the Futures watchlist.';updateFuturesMarginButton();chartRequest++;lastQuoteText='';if(!isReconnect)reconnectAttempt=0;title.textContent=item.trading_symbol||item.name;symbol.textContent=item.instrument_key;price.textContent='—';
    setFeedStatus('Waiting for verified live quote','Connecting to Upstox V3 feed. Prices will appear only when received from the provider.');
    render(items);updatePaperButtons();renderSavedWatchlist();loadCandles();
    if(!gateway||!connector?.getIdToken||!uid){setFeedStatus('Market gateway not configured','Sign in and configure the deployed market gateway to start live quotes.');return;}
    const controller=new AbortController();streamAbort=controller;
    let reader=null;
    try{
      const token=await connector.getIdToken();
      if(controller.signal.aborted||connector.getUserId()!==uid||selected?.instrument_key!==item.instrument_key)return;
      const response=await fetch(gateway+'/stream',{method:'POST',signal:controller.signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({instrumentKeys:[item.instrument_key],mode:'ltpc'})});
      if(controller.signal.aborted||connector.getUserId()!==uid||selected?.instrument_key!==item.instrument_key)return;
      if(!response.ok){
        if(!window.ZenuraReconnectPolicy.shouldRetryFeedStatus(response.status)){
          if(response.status===401||response.status===403){
            setFeedStatus('Upstox authorization required','Your sign-in or broker token is no longer valid. Reconnect Upstox, then select this instrument again.');
          }else{
            setFeedStatus('Live feed request rejected','The gateway rejected this request ('+response.status+'). Check the selected instrument and gateway configuration.');
          }
          return;
        }
        throw new Error('Live feed unavailable ('+response.status+').');
      }
      if(!response.body)throw new Error('Live feed stream is not supported by this browser.');
      reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
      const processEvent=event=>{
          if(connector.getUserId()!==uid||selected?.instrument_key!==item.instrument_key)return;
          const eventName=event.event,dataText=event.data;
          try{
            const data=JSON.parse(dataText);
            if(eventName==='status'&&data.connecting){setFeedStatus('Connecting to live feed','Waiting for the Upstox websocket handshake.');return;}
            if(eventName==='status'&&data.connected===true){setFeedStatus('Live feed connected','Upstox websocket is open. Waiting for the first market quote.');return;}
            if(eventName==='status'&&data.connected===false){if(staleTimer){clearTimeout(staleTimer);staleTimer=null;}price.textContent=lastQuoteText?'STALE · '+lastQuoteText:'—';setFeedStatus('Live feed disconnected','The Upstox stream closed. Reconnecting automatically.');scheduleReconnect(item,uid);return;}
            if(eventName==='error'){if(staleTimer){clearTimeout(staleTimer);staleTimer=null;}price.textContent=lastQuoteText?'STALE · '+lastQuoteText:'—';setFeedStatus('Live feed error',data.message||'The provider stream reported an error.');if(window.ZenuraReconnectPolicy.shouldReconnectAfterFeedError(eventName))scheduleReconnect(item,uid);return;}
            const feed=data.feeds?.[item.instrument_key],quote=window.ZenuraLiveQuote?.extractFreshQuote(feed);
            if(quote){
              // A fresh quote proves the existing stream recovered; cancel any pending reconnect.
              if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
              reconnectAttempt=0;
              lastQuoteText='₹'+(quote.pricePaise/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});price.textContent=lastQuoteText;
              window.ZenuraProfessionalChart?.updateQuote(quote);
              if(staleTimer)clearTimeout(staleTimer);
              staleTimer=setTimeout(()=>{if(connector.getUserId()===uid&&selected?.instrument_key===item.instrument_key){price.textContent='STALE · '+lastQuoteText;setFeedStatus('Live quote is stale','No fresh provider quote received for 15 seconds. Do not use this price for paper orders.');scheduleReconnect(item,uid);}},15000);
              setFeedStatus('Live quote connected','Verified Upstox V3 ticks are updating the professional chart.');
            }
          }catch(_){}
      };
      while(true){
        const {value,done}=await reader.read();
        if(controller.signal.aborted||connector.getUserId()!==uid||selected?.instrument_key!==item.instrument_key)break;
        const chunk=decoder.decode(value||new Uint8Array(),{stream:!done});
        const parsed=window.ZenuraSseParser.parseSseChunk(buffer,chunk,{final:done});
        buffer=parsed.buffer;parsed.events.forEach(processEvent);
        if(done)break;
      }
      if(connector.getUserId()===uid&&selected?.instrument_key===item.instrument_key&&!controller.signal.aborted)scheduleReconnect(item,uid);
    }catch(error){
      if(!controller.signal.aborted&&error.name!=='AbortError'&&connector.getUserId()===uid&&selected?.instrument_key===item.instrument_key){setFeedStatus('Live feed unavailable',error.message||'Live feed connection failed.');scheduleReconnect(item,uid);}
    }finally{
      if(reader){try{await reader.cancel();}catch(_){}}
      if(streamAbort===controller)streamAbort=null;
    }
  }
  tabs.forEach(tab=>tab.addEventListener('click',()=>{
    clearFeedTimers();if(streamAbort){streamAbort.abort();streamAbort=null;}
    tabs.forEach(x=>x.classList.toggle('active',x===tab));activeList=tab.dataset.list;selected=null;window.dispatchEvent(new CustomEvent('zenura:instrument-selected',{detail:{instrument:null}}));resetOptionChain('Select an underlying instrument to load an option chain.');updateFuturesMarginButton();chartRequest++;
    title.textContent='No instrument selected';symbol.textContent='Choose an instrument';price.textContent='—';updatePaperButtons();renderSavedWatchlist();loadInstruments();
  }));
  search.addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(loadInstruments,250);});
  function clearPrivateSession(){
    clearFeedTimers();
    if(streamAbort){streamAbort.abort();streamAbort=null;}
    selected=null;window.dispatchEvent(new CustomEvent('zenura:instrument-selected',{detail:{instrument:null}}));lastQuoteText='';reconnectAttempt=0;
    ++watchlistLoadSeq;++watchQuoteSeq;++watchlistEditSeq;++paperAccountRequest;++paperPortfolioRequest;
    ++paperHistoryLoadSeq;++derivativePortfolioRequest;++optionChainRequest;++futuresMarginRequest;++chartRequest;
    ++paperOrderSubmitSeq;++derivativeOrderSubmitSeq;paperOrderSubmitting=false;derivativeOrderSubmitting=false;
    chart.textContent='';chartStatus.textContent='Sign in to load historical candles';
    futuresMarginStatus.textContent='Sign in to request broker margin preview.';
    paperHistoryCursor=null;paperHistoryHasMore=false;paperHistoryLoading=false;
    savedWatchlist=[];watchQuotes.clear();renderSavedWatchlist();
    watchStatus.textContent='Sign in to view or save your private watchlists.';
    paperCash.textContent='—';paperRealized.textContent='—';
    paperAccountStatus.textContent='Sign in to load your private Indian-market account.';
    paperMarketValue.textContent='—';paperUnrealized.textContent='—';paperEquity.textContent='—';
    paperPortfolioStatus.textContent='Sign in to view your private portfolio.';
    tableMessage(paperPositions,6,'Sign in to view holdings.');
    tableMessage(paperHistory,8,'Sign in to view order history.');
    if(paperHistoryStatus)paperHistoryStatus.textContent='Sign in required';
    if(paperHistoryMore)paperHistoryMore.disabled=true;
    const derivativeBody=document.getElementById('derivative-positions');
    const derivativeStatus=document.getElementById('derivative-portfolio-status');
    const derivativeHistory=document.getElementById('derivative-history');
    if(derivativeBody)tableMessage(derivativeBody,6,'Sign in to view derivative positions.');
    if(derivativeHistory)tableMessage(derivativeHistory,6,'Sign in to view derivative order history.');
    if(derivativeStatus)derivativeStatus.textContent='Sign in required';
    paperOrderStatus.textContent='Sign in to place a private paper order.';
    optionStatus.textContent='Sign in to load a private option chain or place an option paper order.';
    price.textContent='—';title.textContent='No instrument selected';symbol.textContent='Sign in to load market data';
    setFeedStatus('SIGN IN REQUIRED','Your private market session has ended.');
    resetOptionChain('Sign in to load a private option chain.');
    updatePaperButtons();updateFuturesMarginButton();protectiveWorkerEnabled=false;protectiveLoadSeq++;updateProtectiveButton();tableMessage(protectiveBody,8,"Sign in to view protective orders.");protectiveListStatus.textContent="Sign in required";protectiveStatus.textContent="Sign in to load protective execution status.";
  }
  window.addEventListener('zenura-market-auth-ready',event=>{
    // Never leave one account's private data visible while another account is loading.
    clearPrivateSession();
    if(!event.detail?.signedIn||!window.ZENURA_MARKET_CONNECTOR?.isAuthenticated?.())return;
    loadInstruments();loadCandles();loadPaperAccount();refreshPaperViews();loadSavedWatchlist();loadProtectiveOrders();
  });
  window.ZENURA_INDIAN_MARKET={mode:'indian-stocks',provider:'upstox',status:'gateway-configurable',activeList:()=>activeList,getSelectedInstrument:()=>selected,refresh:loadInstruments};
  loadInstruments();
  renderSavedWatchlist();
})();