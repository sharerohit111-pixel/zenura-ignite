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
  let activeList='indices',items=[],selected=null,streamAbort=null,debounce=null;
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
  async function select(item){
    selected=item;title.textContent=item.trading_symbol||item.name;symbol.textContent=item.instrument_key;price.textContent='—';
    document.querySelector('.chart-placeholder b').textContent='Waiting for verified live quote';
    document.querySelector('.chart-placeholder span').textContent='Connecting to Upstox V3 feed. Prices will appear only when received from the provider.';
    render(items);
    if(streamAbort)streamAbort.abort();
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
        const events=buffer.split('\\n\\n');buffer=events.pop()||'';
        for(const event of events){
          const line=event.split('\\n').find(x=>x.startsWith('data: '));if(!line)continue;
          try{
            const data=JSON.parse(line.slice(6));
            const feed=data.feeds?.[item.instrument_key];const quote=feed?.ltpc||feed?.fullFeed?.marketFF?.ltpc||feed?.fullFeed?.indexFF?.ltpc;
            if(quote&&Number.isFinite(Number(quote.ltp))){price.textContent='₹'+Number(quote.ltp).toLocaleString('en-IN',{maximumFractionDigits:2});document.querySelector('.chart-placeholder b').textContent='Live quote connected';document.querySelector('.chart-placeholder span').textContent='Last traded price received from Upstox V3. Chart history is a separate integration.';}
          }catch(_){}
        }
      }
    }catch(error){if(error.name!=='AbortError')document.querySelector('.chart-placeholder span').textContent=error.message||'Live feed connection failed.';}
  }
  tabs.forEach(tab=>tab.addEventListener('click',()=>{
    tabs.forEach(x=>x.classList.toggle('active',x===tab));activeList=tab.dataset.list;selected=null;
    title.textContent='No instrument selected';symbol.textContent='Choose an instrument';price.textContent='—';loadInstruments();
  }));
  search.addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(loadInstruments,250);});
  window.addEventListener('zenura-market-auth-ready',loadInstruments);
  window.ZENURA_INDIAN_MARKET={mode:'indian-stocks',provider:'upstox',status:'gateway-configurable',activeList:()=>activeList,refresh:loadInstruments};
  loadInstruments();
})();