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
  let activeList='indices',items=[],selected=null,streamAbort=null,debounce=null,reconnectTimer=null,staleTimer=null,reconnectAttempt=0,lastQuoteText='';
  function clearFeedTimers(){if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}if(staleTimer){clearTimeout(staleTimer);staleTimer=null;}}
  function scheduleReconnect(item){if(selected?.instrument_key!==item.instrument_key||reconnectTimer)return;const delay=Math.min(30000,1000*Math.pow(2,Math.min(reconnectAttempt,5)));reconnectAttempt++;document.querySelector('.chart-placeholder span').textContent='Live feed disconnected. Reconnecting in '+Math.round(delay/1000)+'s…';reconnectTimer=setTimeout(()=>{reconnectTimer=null;if(selected?.instrument_key===item.instrument_key)select(item);},delay);}
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
    if(!gateway){message('Market gateway URL is not configured yet. Deploy Cloud Run and set the market-gateway-url meta value.');return;}
    message('Loading official Upstox instrument master…');
    const params=new URLSearchParams({kind:activeList,limit:'100'});
    if(search.value.trim())params.set('q',search.value.trim());
    try{
      const response=await fetch(gateway+'/instruments?'+params.toString(),{headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error('Instrument service unavailable ('+response.status+').');
      const data=await response.json();items=data.results||[];render(items);
    }catch(error){message(error.message||'Could not load instruments.');}
  }
  const paperCash=document.getElementById('paper-cash'),paperRealized=document.getElementById('paper-realized'),paperAccountStatus=document.getElementById('paper-account-status'),paperOrderStatus=document.getElementById('paper-order-status'),paperQuantity=document.getElementById('paper-quantity'),paperBuy=document.getElementById('paper-buy'),paperSell=document.getElementById('paper-sell');
  function inrPaise(value){return '₹'+(Number(value||0)/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}
  async function loadPaperAccount(){
    const connector=window.ZENURA_MARKET_CONNECTOR;
    if(!gateway||!connector?.getIdToken)return;
    try{
      const token=await connector.getIdToken(),response=await fetch(gateway+'/paper/account',{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Paper account unavailable');
      paperCash.textContent=inrPaise(data.cashPaise);paperRealized.textContent=inrPaise(data.realizedPnlPaise);
      paperAccountStatus.textContent='Separate Indian-market virtual account · No real funds';
      paperOrderStatus.textContent='Ready for simulated NSE/BSE equity market orders only.';
      updatePaperButtons();
    }catch(error){paperAccountStatus.textContent=error.message||'Paper account not ready';}
  }
  const paperMarketValue=document.getElementById('paper-market-value'),paperUnrealized=document.getElementById('paper-unrealized'),paperEquity=document.getElementById('paper-equity'),paperPortfolioStatus=document.getElementById('paper-portfolio-status'),paperPositions=document.getElementById('paper-positions'),paperHistory=document.getElementById('paper-history'),paperRefresh=document.getElementById('refresh-paper-portfolio');
  function tableMessage(body,columns,message){body.textContent='';const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=columns;td.textContent=message;tr.append(td);body.append(tr);}
  function signedMoney(value){const n=Number(value||0);return (n>0?'+':n<0?'−':'')+inrPaise(Math.abs(n));}
  async function loadPaperPortfolio(){
    if(!gateway||!window.ZENURA_MARKET_CONNECTOR?.getIdToken)return;
    paperPortfolioStatus.textContent='Refreshing verified market valuation…';
    try{
      const token=await window.ZENURA_MARKET_CONNECTOR.getIdToken(),response=await fetch(gateway+'/paper/portfolio',{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Portfolio valuation unavailable');
      paperMarketValue.textContent=inrPaise(data.marketValuePaise);paperUnrealized.textContent=signedMoney(data.unrealizedPnlPaise);paperEquity.textContent=inrPaise(data.equityPaise);
      paperPortfolioStatus.textContent=data.valuationStatus==='fresh'?'All holdings valued from fresh Upstox quotes.':data.valuationStatus==='no_open_positions'?'No open holdings.':'Some quotes are stale or unavailable; those positions are excluded from totals ('+data.stalePositions+').';
      paperPositions.textContent='';
      if(!data.positions?.length)tableMessage(paperPositions,6,'No open holdings.');
      else data.positions.forEach(p=>{
        const tr=document.createElement('tr');
        [p.tradingSymbol,p.quantity,inrPaise(p.averagePricePaise),p.lastPricePaise===null?'STALE':inrPaise(p.lastPricePaise),p.marketValuePaise===null?'—':inrPaise(p.marketValuePaise),p.unrealizedPnlPaise===null?'—':signedMoney(p.unrealizedPnlPaise)].forEach(v=>{const td=document.createElement('td');td.textContent=String(v);tr.append(td);});
        paperPositions.append(tr);
      });
    }catch(error){paperPortfolioStatus.textContent=error.message||'Portfolio refresh failed.';}
  }
  async function loadPaperHistory(){
    if(!gateway||!window.ZENURA_MARKET_CONNECTOR?.getIdToken)return;
    try{
      const token=await window.ZENURA_MARKET_CONNECTOR.getIdToken(),response=await fetch(gateway+'/paper/orders?limit=50',{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Order history unavailable');
      paperHistory.textContent='';
      if(!data.orders?.length){tableMessage(paperHistory,6,'No paper orders yet.');return;}
      data.orders.forEach(order=>{
        const tr=document.createElement('tr'),date=order.createdAt?new Date(order.createdAt).toLocaleString('en-IN'):'—';
        [date,order.tradingSymbol,order.side,order.quantity,inrPaise(order.executionPricePaise),order.status+' · SIM'].forEach(v=>{const td=document.createElement('td');td.textContent=String(v);tr.append(td);});
        paperHistory.append(tr);
      });
    }catch(error){tableMessage(paperHistory,6,error.message||'Could not load order history.');}
  }
  async function refreshPaperViews(){await Promise.all([loadPaperPortfolio(),loadPaperHistory()]);}
  paperRefresh.addEventListener('click',refreshPaperViews);

  function updatePaperButtons(){
    const allowed=!!selected&&['NSE_EQ','BSE_EQ'].includes(selected.segment)&&selected.instrument_type==='EQ'&&!!window.ZENURA_MARKET_CONNECTOR?.getIdToken&&!!gateway;
    paperBuy.disabled=!allowed;paperSell.disabled=!allowed;
  }
  async function submitPaperOrder(side){
    const qty=Number(paperQuantity.value);
    if(!Number.isSafeInteger(qty)||qty<1||qty>1000000){paperOrderStatus.textContent='Enter a whole-number quantity between 1 and 1,000,000.';return;}
    if(!selected||!['NSE_EQ','BSE_EQ'].includes(selected.segment)||selected.instrument_type!=='EQ'){paperOrderStatus.textContent='Select an NSE/BSE cash equity first.';return;}
    paperBuy.disabled=true;paperSell.disabled=true;paperOrderStatus.textContent='Verifying fresh provider quote and processing simulated order…';
    try{
      const token=await window.ZENURA_MARKET_CONNECTOR.getIdToken();
      const response=await fetch(gateway+'/paper/orders',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({instrument_key:selected.instrument_key,side,quantity:qty})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Paper order rejected');
      paperOrderStatus.textContent=side+' '+qty+' '+(data.tradingSymbol||selected.trading_symbol)+' filled at '+inrPaise(data.executionPricePaise)+' · Simulated only';
      await loadPaperAccount();await refreshPaperViews();
    }catch(error){paperOrderStatus.textContent=error.message||'Paper order failed.';}
    finally{updatePaperButtons();}
  }
  paperBuy.addEventListener('click',()=>submitPaperOrder('BUY'));
  paperSell.addEventListener('click',()=>submitPaperOrder('SELL'));

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
      optionBody.append(tr);
    });
  }
  async function loadOptionChain(){
    if(!selected){optionStatus.textContent='Select an underlying instrument first';return;}
    if(!['NSE_INDEX','BSE_INDEX','NSE_EQ','BSE_EQ'].includes(selected.segment)){optionStatus.textContent='Option chain requires an NSE/BSE index or cash-equity underlying, not an option or futures contract.';return;}
    if(!gateway||!window.ZENURA_MARKET_CONNECTOR?.getIdToken){optionStatus.textContent='Sign in and configure the market gateway first';return;}
    optionButton.disabled=true;optionStatus.textContent='Loading official Upstox option chain…';
    try{
      const token=await window.ZENURA_MARKET_CONNECTOR.getIdToken();
      const params=new URLSearchParams({instrument_key:selected.instrument_key,expiry_date:optionExpiry.value});
      const response=await fetch(gateway+'/option-chain?'+params,{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      if(!response.ok)throw new Error('Option chain unavailable ('+response.status+').');
      const payload=await response.json();renderOptionChain(payload.data||[]);
      optionStatus.textContent='Provider response · '+(payload.data?.length||0)+' strikes · '+optionExpiry.value;
    }catch(error){optionStatus.textContent=error.message||'Option chain request failed.';}
    finally{optionButton.disabled=false;}
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
  function renderChart(candles){
    chart.textContent='';
    if(!candles.length){const b=document.createElement('b');b.textContent='No candle data returned';const span=document.createElement('span');span.textContent='Upstox returned no historical candles for this instrument and interval.';chart.append(b,span);return;}
    const rows=candles.filter(c=>Array.isArray(c)&&c.length>=5&&[1,2,3,4].every(i=>Number.isFinite(Number(c[i]))));
    if(!rows.length){const b=document.createElement('b');b.textContent='Candle response unavailable';chart.append(b);return;}
    const width=900,height=300,pad=24,high=Math.max(...rows.map(c=>Number(c[2]))),low=Math.min(...rows.map(c=>Number(c[3]))),range=high-low||1;
    const points=rows.slice().reverse().map((c,i)=>({x:pad+i*(width-2*pad)/Math.max(rows.length-1,1),y:height-pad-(Number(c[4])-low)*(height-2*pad)/range,c}));
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','Historical close price chart from Upstox');
    for(let i=0;i<5;i++){const y=pad+i*(height-2*pad)/4;const line=document.createElementNS(svg.namespaceURI,'line');line.setAttribute('x1',pad);line.setAttribute('x2',width-pad);line.setAttribute('y1',y);line.setAttribute('y2',y);line.setAttribute('class','chart-gridline');svg.append(line);}
    const poly=document.createElementNS(svg.namespaceURI,'polyline');poly.setAttribute('points',points.map(p=>p.x+','+p.y).join(' '));poly.setAttribute('class','chart-line');svg.append(poly);
    const latest=rows[0],first=rows[rows.length-1],change=Number(latest[4])-Number(first[1]);
    const summary=document.createElement('div');summary.className='candle-summary';
    [['O',latest[1]],['H',latest[2]],['L',latest[3]],['C',latest[4]],['VOL',latest[5]??'—'],['OI',latest[6]??'—']].forEach(([k,v])=>{const cell=document.createElement('span');cell.textContent=k+' '+(typeof v==='number'?Number(v).toLocaleString('en-IN'):v);summary.append(cell);});
    const rangeLabel=document.createElement('small');rangeLabel.className='chart-range';rangeLabel.textContent=rows.length+' candles · '+String(rows[rows.length-1][0])+' → '+String(rows[0][0])+' · Change '+(change>=0?'+':'')+change.toFixed(2);
    chart.append(svg,summary,rangeLabel);
  }
  async function loadCandles(){
    if(!selected||!gateway)return;
    const connector=window.ZENURA_MARKET_CONNECTOR;
    if(!connector?.getIdToken){chartStatus.textContent='Sign in to load historical candles';return;}
    const request=++chartRequest,[unit,interval,days]=frames[activeTimeframe];
    chart.textContent='';const loading=document.createElement('b');loading.textContent='Loading verified historical candles…';chart.append(loading);chartStatus.textContent='Requesting Upstox V3';
    try{
      const token=await connector.getIdToken(),to=localDate(),from=localDate(-days);
      const params=new URLSearchParams({instrument_key:selected.instrument_key,unit,interval:String(interval),to_date:to,from_date:from});
      const response=await fetch(gateway+'/candles?'+params,{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      if(!response.ok)throw new Error('Historical candles unavailable ('+response.status+').');
      const payload=await response.json();if(request!==chartRequest)return;
      renderChart(payload.data?.candles||[]);chartStatus.textContent='Historical candles · Upstox V3 · '+activeTimeframe;
    }catch(error){if(request!==chartRequest)return;chart.textContent='';const b=document.createElement('b');b.textContent='Chart data unavailable';const span=document.createElement('span');span.textContent=error.message||'Could not load historical candles.';chart.append(b,span);chartStatus.textContent='Not connected';}
  }
  timeframeButtons.forEach(button=>button.addEventListener('click',()=>{activeTimeframe=button.dataset.timeframe;timeframeButtons.forEach(x=>x.classList.toggle('active',x===button));loadCandles();}));
  async function select(item){
    clearFeedTimers();
    if(streamAbort){streamAbort.abort();streamAbort=null;}
    selected=item;chartRequest++;lastQuoteText='';reconnectAttempt=0;title.textContent=item.trading_symbol||item.name;symbol.textContent=item.instrument_key;price.textContent='—';
    document.querySelector('.chart-placeholder b').textContent='Waiting for verified live quote';
    document.querySelector('.chart-placeholder span').textContent='Connecting to Upstox V3 feed. Prices will appear only when received from the provider.';
    render(items);
    updatePaperButtons();
    loadCandles();
    const connector=window.ZENURA_MARKET_CONNECTOR;
    if(!gateway||!connector?.getIdToken){document.querySelector('.chart-placeholder span').textContent='Sign in and configure the deployed market gateway to start live quotes.';return;}
    const controller=new AbortController();streamAbort=controller;
    try{
      const token=await connector.getIdToken();
      const response=await fetch(gateway+'/stream',{method:'POST',signal:controller.signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({instrumentKeys:[item.instrument_key],mode:'ltpc'})});
      if(!response.ok)throw new Error('Live feed unavailable ('+response.status+').');
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
      while(true){
        const {value,done}=await reader.read();if(done)break;
        buffer+=decoder.decode(value,{stream:true});
        const events=buffer.split(/\r?\n\r?\n/);buffer=events.pop()||'';
        for(const event of events){
          const line=event.split(/\r?\n/).find(x=>x.startsWith('data: '));if(!line)continue;
          try{
            const data=JSON.parse(line.slice(6));
            const feed=data.feeds?.[item.instrument_key];const quote=feed?.ltpc||feed?.fullFeed?.marketFF?.ltpc||feed?.fullFeed?.indexFF?.ltpc;
            if(quote&&Number.isFinite(Number(quote.ltp))){lastQuoteText='₹'+Number(quote.ltp).toLocaleString('en-IN',{maximumFractionDigits:2});price.textContent=lastQuoteText;reconnectAttempt=0;if(staleTimer)clearTimeout(staleTimer);staleTimer=setTimeout(()=>{if(selected?.instrument_key===item.instrument_key){price.textContent='STALE · '+lastQuoteText;document.querySelector('.chart-placeholder b').textContent='Live quote is stale';document.querySelector('.chart-placeholder span').textContent='No fresh provider quote received for 15 seconds. Do not use this price for paper orders.';}},15000);document.querySelector('.chart-placeholder b').textContent='Live quote connected';document.querySelector('.chart-placeholder span').textContent='Last traded price received from Upstox V3. Chart history is a separate integration.';}
          }catch(_){}
        }
      }
      if(selected?.instrument_key===item.instrument_key&&!controller.signal.aborted)scheduleReconnect(item);
    }catch(error){if(error.name!=='AbortError'){document.querySelector('.chart-placeholder span').textContent=error.message||'Live feed connection failed.';scheduleReconnect(item);}}
  }
  tabs.forEach(tab=>tab.addEventListener('click',()=>{
    clearFeedTimers();if(streamAbort){streamAbort.abort();streamAbort=null;}
    tabs.forEach(x=>x.classList.toggle('active',x===tab));activeList=tab.dataset.list;selected=null;chartRequest++;
    title.textContent='No instrument selected';symbol.textContent='Choose an instrument';price.textContent='—';updatePaperButtons();loadInstruments();
  }));
  search.addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(loadInstruments,250);});
  window.addEventListener('zenura-market-auth-ready',()=>{loadInstruments();loadCandles();loadPaperAccount();refreshPaperViews();});
  window.ZENURA_INDIAN_MARKET={mode:'indian-stocks',provider:'upstox',status:'gateway-configurable',activeList:()=>activeList,refresh:loadInstruments};
  loadInstruments();
})();