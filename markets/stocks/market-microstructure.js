/* Isolated market microstructure UI: provider-verified depth, exchange status and contract selectors. */
(function(){
  "use strict";
  const gateway=(document.querySelector('meta[name="market-gateway-url"]')?.content||"").trim().replace(/\/+$/,"");
  const connector=()=>window.ZENURA_MARKET_CONNECTOR;
  const state={instrument:null,depthTimer:null,statusTimer:null,depthRequest:0,statusRequest:0,depthInFlight:false,depthQueued:false};
  const statusStrip=document.createElement("section");
  statusStrip.className="exchange-status-strip";
  statusStrip.setAttribute("aria-label","NSE and BSE market status");
  for(const exchange of ["NSE","BSE"]){
    const card=document.createElement("div");card.className="exchange-status-card";card.dataset.exchange=exchange;
    const label=document.createElement("div"),name=document.createElement("b"),meta=document.createElement("small"),value=document.createElement("span");
    name.textContent=exchange+" MARKET";meta.textContent="Waiting for verified exchange status";value.className="exchange-status-value";value.textContent="—";
    label.append(name,meta);card.append(label,value);statusStrip.append(card);
  }
  document.querySelector(".notice")?.after(statusStrip);
  const depth=document.createElement("section");depth.className="depth-panel";depth.setAttribute("aria-label","Market depth");
  const head=document.createElement("div");head.className="depth-head";
  const heading=document.createElement("h3");heading.textContent="MARKET DEPTH · TOP 5";
  const stamp=document.createElement("small");stamp.textContent="Select an instrument";head.append(heading,stamp);
  const grid=document.createElement("div");grid.className="depth-grid";
  const sides={};
  for(const [key,label] of [["bid","BIDS"],["ask","ASKS"]]){
    const section=document.createElement("div");section.className="depth-side";
    const h=document.createElement("h4");h.textContent=label;const body=document.createElement("div");body.className="depth-empty";body.textContent="No instrument selected";
    section.append(h,body);grid.append(section);sides[key]=body;
  }
  depth.append(head,grid);document.querySelector(".chart-tools")?.after(depth);
  function showDepthMessage(message){for(const body of Object.values(sides)){body.className="depth-empty";body.textContent=message;}}
  function formatPrice(paise){return "₹"+(paise/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});}
  function renderSide(target,levels,kind){
    target.textContent="";target.className="";
    if(!levels.length){target.className="depth-empty";target.textContent="No displayed levels";return;}
    levels.forEach(level=>{
      const row=document.createElement("div");row.className="depth-row "+kind;
      const p=document.createElement("span"),q=document.createElement("span"),o=document.createElement("span");
      p.textContent=formatPrice(level.pricePaise);q.textContent=Number(level.quantity).toLocaleString("en-IN");o.textContent=(Number.isSafeInteger(level.orders)?Number(level.orders).toLocaleString("en-IN"):"—")+" ord";
      row.append(p,q,o);target.append(row);
    });
  }
  async function request(path){
    const c=connector(),uid=c?.getUserId?.();
    if(!gateway||!c?.getIdToken||!uid)throw new Error("Sign in and connect Upstox to view verified market data.");
    const token=await c.getIdToken();
    if(c.getUserId()!==uid)throw new Error("Account changed. Refresh market data.");
    const response=await fetch(gateway+path,{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Market data unavailable.");
    if(c.getUserId()!==uid)throw new Error("Account changed. Refresh market data.");
    return data;
  }
  async function refreshDepth(){
    const item=state.instrument;
    if(!item)return;\n    if(state.depthInFlight){state.depthQueued=true;return;}
    state.depthInFlight=true;
    const requestId=++state.depthRequest;
    if(!item){showDepthMessage("No instrument selected");return;}
    try{
      const data=await request("/market-depth?"+new URLSearchParams({instrument_key:item.instrument_key}));
      if(requestId!==state.depthRequest||state.instrument?.instrument_key!==item.instrument_key)return;
      renderSide(sides.bid,data.bids||[],"bid");renderSide(sides.ask,data.asks||[],"ask");
      const time=new Date(data.timestampMs).toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata"});
      stamp.textContent=(data.status==="fresh"?"FRESH":"STALE")+" · "+time+" IST · "+data.provider;
      stamp.classList.toggle("depth-stale",data.status!=="fresh");
      if(data.status!=="fresh")stamp.textContent+=" · DO NOT USE AS LIVE";
    }catch(error){if(requestId===state.depthRequest){showDepthMessage(error.message||"Depth unavailable");stamp.textContent="Unavailable";stamp.classList.add("depth-stale");}}
    finally{state.depthInFlight=false;if(state.depthQueued){state.depthQueued=false;refreshDepth();}}
  }
  function statusLabel(value){
    return ({NORMAL_OPEN:"OPEN",NORMAL_CLOSE:"CLOSED",PRE_OPEN_START:"PRE-OPEN",PRE_OPEN_END:"PRE-OPEN ENDED",PRE_OPEN_M_END:"PRE-OPEN MATCHING",CLOSING_START:"CLOSING",CLOSING_END:"CLOSING ENDED",CTS_CLOSE:"CONTINUOUS TRADING CLOSED",CAS_LM_START:"CLOSING AUCTION",CAS_M_STOP:"CAS MARKET ORDERS STOPPED",CAS_STOP:"CAS CLOSED"})[value]||value||"UNKNOWN";
  }
  async function refreshStatuses(){
    const requestId=++state.statusRequest;
    await Promise.all(["NSE","BSE"].map(async exchange=>{
      const card=statusStrip.querySelector('[data-exchange="'+exchange+'"]'),meta=card.querySelector("small"),value=card.querySelector(".exchange-status-value");
      try{
        const data=await request("/market-status?exchange="+exchange);
        if(requestId!==state.statusRequest)return;
        value.textContent=statusLabel(data.status)+(data.casStatus?" · CAS "+statusLabel(data.casStatus)+(data.casFreshness==="stale"?" (STALE)":""):"");
        value.classList.toggle("closed",data.status!=="NORMAL_OPEN");
        value.classList.toggle("stale",data.freshness!=="fresh"||data.casFreshness==="stale");
        meta.textContent=(data.freshness==="fresh"?"Verified":"STALE")+" · Updated "+new Date(data.lastUpdatedMs).toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata"})+" IST";
      }catch(error){if(requestId===state.statusRequest){value.textContent="UNAVAILABLE";value.classList.add("stale");meta.textContent=error.message||"Exchange status unavailable";}}
    }));
  }
  function dateValue(value){
    if(typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
    const n=Number(value);if(Number.isFinite(n)&&n>0)return new Date(n).toISOString().slice(0,10);
    return null;
  }
  async function populateExpiries(item){
    const select=document.getElementById("option-expiry");
    if(!select||!["NSE_INDEX","BSE_INDEX","NSE_EQ","BSE_EQ"].includes(item.segment))return;
    const previous=select.value,underlying=item.underlying_symbol||String(item.trading_symbol||item.name||"").split(" ")[0];
    try{
      const data=await request("/instruments?"+new URLSearchParams({kind:"options",q:underlying,limit:"100"}));
      if(state.instrument?.instrument_key!==item.instrument_key)return;
      const dates=[...new Set((data.results||[]).map(x=>dateValue(x.expiry)).filter(Boolean))].sort();
      [...select.options].filter(o=>o.dataset.dynamic==="true").forEach(o=>o.remove());
      dates.forEach(date=>{const option=document.createElement("option");option.value=date;option.textContent=new Date(date+"T00:00:00+05:30").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});option.dataset.dynamic="true";select.append(option);});
      if(dates.includes(previous))select.value=previous;else if(dates.length)select.value=dates[0];
    }catch(_){/* Relative expiry presets remain available when listing is unavailable. */}
  }
  function setupStrikePicker(rows){
    const controls=document.querySelector(".option-controls"),table=document.getElementById("option-chain-body");
    if(!controls||!table)return;
    let picker=controls.querySelector(".strike-picker");if(!picker){picker=document.createElement("div");picker.className="strike-picker";const label=document.createElement("label");label.textContent="Jump to strike";label.htmlFor="option-strike-picker";const select=document.createElement("select");select.id="option-strike-picker";picker.append(label,select);controls.append(picker);}
    const select=picker.querySelector("select"),strikes=[...new Set((rows||[]).map(x=>String(x.strike_price)).filter(x=>x!=="undefined"&&x!=="null"))].sort((a,b)=>Number(a)-Number(b));
    select.textContent="";const all=document.createElement("option");all.value="";all.textContent="All strikes";select.append(all);
    strikes.forEach(strike=>{const option=document.createElement("option");option.value=strike;option.textContent=Number(strike).toLocaleString("en-IN");select.append(option);});
    select.onchange=()=>{table.querySelectorAll("tr[data-strike-price]").forEach(row=>{const match=!select.value||row.dataset.strikePrice===select.value;row.hidden=!match;row.classList.toggle("selected-strike",match&&!!select.value);});};
  }
  function attachReorderControls(){
    const container=document.getElementById("saved-watchlist");if(!container)return;
    container.querySelectorAll(".saved-watch-row").forEach(row=>{
      if(row.querySelector(".saved-watch-order"))return;
      const tools=document.createElement("div");tools.className="saved-watch-order";
      [["up","↑","Move up"],["down","↓","Move down"]].forEach(([direction,glyph,label])=>{
        const button=document.createElement("button");button.type="button";button.dataset.move=direction;button.textContent=glyph;button.setAttribute("aria-label",label);tools.append(button);
      });
      row.append(tools);
    });
    const rows=[...container.querySelectorAll(".saved-watch-row")];
    rows.forEach((row,index)=>{row.querySelector('[data-move="up"]').disabled=index===0;row.querySelector('[data-move="down"]').disabled=index===rows.length-1;});
  }
  document.getElementById("saved-watchlist")?.addEventListener("click",async event=>{
    const button=event.target.closest("[data-move]");if(!button)return;
    const row=button.closest(".saved-watch-row"),container=document.getElementById("saved-watchlist"),rows=[...container.querySelectorAll(".saved-watch-row")],index=rows.indexOf(row),next=index+(button.dataset.move==="up"?-1:1);
    if(index<0||next<0||next>=rows.length)return;
    const previous=rows.slice();if(next<index)container.insertBefore(row,rows[next]);else container.insertBefore(rows[next],row);
    attachReorderControls();
    try{
      const keys=[...container.querySelectorAll(".saved-watch-row")].map(x=>x.dataset.instrumentKey).filter(Boolean);
      const name=document.getElementById("watchlist-select")?.value||"My Stocks";
      const c=connector(),uid=c?.getUserId?.();if(!c?.getIdToken||!uid)throw new Error("Sign in to reorder this watchlist.");
      const token=await c.getIdToken();if(c.getUserId()!==uid)throw new Error("Account changed. Refresh the watchlist.");
      const response=await fetch(gateway+"/watchlist?name="+encodeURIComponent(name),{method:"PUT",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({name,instrumentKeys:keys})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||"Watchlist order could not be saved.");
      const status=document.getElementById("watchlist-status");if(status)status.textContent="Watchlist order saved.";
    }catch(error){previous.forEach(item=>container.append(item));attachReorderControls();const status=document.getElementById("watchlist-status");if(status)status.textContent=error.message||"Watchlist order could not be saved.";}
  });
  const watchlist=document.getElementById("saved-watchlist");
  if(watchlist)new MutationObserver(attachReorderControls).observe(watchlist,{childList:true});
  window.addEventListener("zenura:instrument-selected",event=>{
    const item=event.detail?.instrument;if(!item)return;
    state.instrument=item;state.depthRequest++;showDepthMessage("Loading verified market depth…");stamp.textContent="Refreshing";
    refreshDepth();populateExpiries(item);
  });
  window.addEventListener("zenura:option-chain-loaded",event=>setupStrikePicker(event.detail?.rows||[]));
  refreshStatuses();state.statusTimer=setInterval(refreshStatuses,60000);
  state.depthTimer=setInterval(()=>{if(state.instrument)refreshDepth();},15000);
})();
