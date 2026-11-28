(function(){
  "use strict";
  const links=[...document.querySelectorAll("[data-terminal-page]")];
  const workspace=document.querySelector(".workspace");
  const pageRoot=document.querySelector("main.wrap");
  if(!links.length||!pageRoot)return;
  const pageSections={
    dashboard:[".stock-hero",".notice",".dashboard-overview"],
    chart:[".workspace"],
    watchlist:[".workspace"],
    balance:[".workspace",".paper-order-book"],
    orders:[".paper-order-book",".protective-orders-panel"],
    history:[".paper-order-book",".portfolio-panel"],
    positions:[".portfolio-panel",".futures-portfolio-panel"],
    pnl:[".portfolio-panel"],
    derivatives:[".futures-margin-panel",".futures-order-panel",".futures-limit-panel",".futures-portfolio-panel",".options-limit-panel",".option-panel"],
    support:[".support-page"],
    settings:[".settings-page"]
  };
  const pageElements=[...new Set(Object.values(pageSections).flat())];
  const dashboard=document.createElement("section");
  dashboard.className="panel dashboard-overview";
  dashboard.innerHTML='<div class="panel-head"><div><small>YOUR PAPER TRADING WORKSPACE</small><h2>Trading Overview</h2></div><span class="pill muted">PAPER ONLY</span></div><p class="portfolio-status">This overview uses account and connection status already loaded by the terminal. It does not create sample balances, prices or trades.</p><div class="dashboard-status-grid"><article><small>DATA CONNECTION</small><b id="dashboard-feed-status">Checking connection…</b></article><article><small>ACCOUNT</small><b id="dashboard-account-status">Sign-in required</b></article><article><small>TRADING MODE</small><b>Virtual · No broker orders</b></article></div><div class="market-pulse"><div class="market-pulse-head"><b>Market snapshot</b><span>Verified quotes only</span></div><div class="market-pulse-grid"><article><small>NIFTY 50</small><strong>—</strong><span>Awaiting authorized feed</span></article><article><small>SENSEX</small><strong>—</strong><span>Awaiting authorized feed</span></article><article><small>BANK NIFTY</small><strong>—</strong><span>Awaiting authorized feed</span></article><article><small>INDIA VIX</small><strong>—</strong><span>Awaiting authorized feed</span></article></div></div><div class="dashboard-shortcuts"><a href="#chart" data-go-page="chart">Open Chart &amp; Trade</a><a href="#watchlist" data-go-page="watchlist">Manage Watchlist</a><a href="#balance" data-go-page="balance">View Virtual Wallet</a><a href="#positions" data-go-page="positions">Open Positions</a><a href="#orders" data-go-page="orders">View Orders</a><a href="#pnl" data-go-page="pnl">View P&amp;L</a></div>';
  const hero=document.querySelector(".stock-hero");
  if(hero)hero.insertAdjacentElement("afterend",dashboard);
  const settings=document.createElement("section");
  settings.className="panel settings-page";
  settings.innerHTML='<div class="panel-head"><div><small>APP PREFERENCES</small><h2>Settings</h2></div><span class="pill muted">LOCAL DISPLAY</span></div><div class="settings-row"><div><b>Language</b><p>Switch terminal labels between English and Hindi.</p></div><button type="button" data-settings-action="language">Change language</button></div><div class="settings-row"><div><b>App appearance</b><p>Switch the complete app between Day and Night modes.</p></div><button type="button" data-settings-action="theme">Change app theme</button></div><div class="settings-row"><div><b>Account connection</b><p id="settings-connection-copy">Sign in to view private paper account data.</p></div><button type="button" data-settings-action="account">Sign in / connect</button></div><p class="portfolio-status">Paper Trading only. No real broker orders are submitted. Live market-data display remains unavailable until the required provider and exchange permissions are verified.</p>';
  const support=document.createElement("section");
  support.className="panel support-page";
  support.innerHTML='<div class="panel-head"><div><small>ZENURA IGNITE ASSISTANCE</small><h2>Help, Support &amp; Suggestions</h2></div><span class="pill muted">PAPER TRADING</span></div><p class="portfolio-status">अपनी समस्या या सुझाव यहाँ लिखें। यह ड्राफ्ट इसी डिवाइस पर रहेगा; अभी सर्वर पर सबमिट नहीं होगा।</p><div class="settings-row"><div><b>Quick help</b><p>लॉगिन, Upstox कनेक्शन, वॉचलिस्ट और पेपर ऑर्डर से जुड़ी सहायता।</p></div></div><label class="support-message-label" for="support-suggestion">अपनी समस्या / सुझाव लिखें</label><textarea id="support-suggestion" rows="5" maxlength="2000" placeholder="यहाँ अपना संदेश लिखें…"></textarea><div class="support-actions"><button type="button" id="support-save-draft">ड्राफ्ट सेव करें</button><button type="button" id="support-copy-draft">कॉपी करें</button></div><p id="support-draft-status" class="portfolio-status" role="status">कोई ड्राफ्ट सेव नहीं है।</p>';
  pageRoot.append(support);
  const footer=document.querySelector("footer");
  if(footer)footer.insertAdjacentElement("beforebegin",settings);else pageRoot.append(settings);
  function setHidden(selector,hidden){document.querySelectorAll(selector).forEach(el=>el.dataset.pageHidden=String(hidden));}
  function syncStatus(){
    const feed=document.querySelector("#connection-title")?.textContent?.trim()||"Not connected";
    const account=document.querySelector("#paper-account-status")?.textContent?.trim()||"Sign-in required";
    const dashboardFeed=document.querySelector("#dashboard-feed-status");
    const dashboardAccount=document.querySelector("#dashboard-account-status");
    const settingsCopy=document.querySelector("#settings-connection-copy");
    if(dashboardFeed)dashboardFeed.textContent=feed;
    if(dashboardAccount)dashboardAccount.textContent=account;
    if(settingsCopy)settingsCopy.textContent=account;
  }
  function configureWorkspace(page){
    if(!workspace)return;
    const show={chart:["chart-panel","order-panel"],watchlist:["watch"],balance:["order-panel"]}[page]||[];
    [...workspace.children].forEach(el=>el.dataset.pageHidden=String(!show.includes([...el.classList].find(c=>["watch","chart-panel","order-panel"].includes(c)))));
  }
  function configureWallet(page){
    const panel=document.querySelector(".order-panel");
    if(!panel)return;
    const walletChildren=new Set([0,2,7]);
    [...panel.children].forEach((el,index)=>{el.dataset.pageHidden=String(page==="balance"?!walletChildren.has(index):false);});
  }
  function configureOrderBook(page){
    const book=document.querySelector(".paper-order-book");
    if(!book)return;
    [...book.children].forEach((el,index)=>{
      const orders=[0,1,2,3,4,5].includes(index);
      const history=[6,7,8].includes(index);
      const balance=[1,2].includes(index);
      const visible=page==="orders"?orders:page==="history"?history:page==="balance"?balance:true;
      el.dataset.pageHidden=String(!visible);
    });
  }
  function configurePortfolio(page){
    const panel=document.querySelector(".portfolio-panel");
    if(!panel)return;
    const children=[...panel.children];
    const pnlIndices=new Set([0,1,2,3]);
    const positionIndices=new Set([0,2,4,7,8]);
    const historyIndices=new Set([5,6,9,10]);
    children.forEach((el,i)=>{
      const visible=page==="pnl"?pnlIndices.has(i):page==="positions"?positionIndices.has(i):page==="history"?historyIndices.has(i):true;
      el.dataset.pageHidden=String(!visible);
    });
    panel.querySelectorAll(".portfolio-metrics").forEach(el=>el.dataset.pageHidden=String(page!=="pnl"));
  }
  function show(page,updateHash){
    if(!pageSections[page])page="dashboard";
    document.body.dataset.terminalPage=page;
    pageElements.forEach(sel=>setHidden(sel,!pageSections[page].includes(sel)));
    configureWorkspace(page);
    configureWallet(page);
    configureOrderBook(page);
    configurePortfolio(page);
    links.forEach(a=>{const active=a.dataset.terminalPage===page;if(active)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");});
    syncStatus();
    if(updateHash&&location.hash!=="#"+page)history.replaceState(null,"","#"+page);
    window.scrollTo({top:0,behavior:"auto"});
  }
  links.forEach(a=>a.addEventListener("click",e=>{e.preventDefault();show(a.dataset.terminalPage,true);}));
  pageRoot.addEventListener("click",e=>{
    const shortcut=e.target.closest("[data-go-page]");
    if(shortcut){e.preventDefault();show(shortcut.dataset.goPage,true);return;}
    const action=e.target.closest("[data-settings-action]")?.dataset.settingsAction;
    if(action==="language")document.querySelector("#paper-language-toggle")?.click();
    if(action==="theme")document.querySelector("[data-app-theme-toggle]")?.click();
    if(action==="account")document.querySelector("#upstox-connect")?.click();
  });
  support.addEventListener("click",e=>{
    const action=e.target.closest("#support-save-draft,#support-copy-draft")?.id;
    if(!action)return;
    const field=document.querySelector("#support-suggestion");
    const status=document.querySelector("#support-draft-status");
    const value=field?.value?.trim()||"";
    if(!value){if(status)status.textContent="पहले अपना संदेश लिखें।";return;}
    if(action==="support-save-draft"){
      try{localStorage.setItem("zenura-s-trade-support-draft",value);if(status)status.textContent="ड्राफ्ट इस डिवाइस पर सेव हो गया।";}
      catch(_){if(status)status.textContent="ड्राफ्ट सेव नहीं हो पाया।";}
    }else if(navigator.clipboard?.writeText){
      navigator.clipboard.writeText(value).then(()=>{if(status)status.textContent="संदेश कॉपी हो गया।"}).catch(()=>{if(status)status.textContent="कॉपी नहीं हो पाया; संदेश चुनकर कॉपी करें।"});
    }else if(status)status.textContent="इस ब्राउज़र में कॉपी सुविधा उपलब्ध नहीं है।";
  });
  try{const saved=localStorage.getItem("zenura-s-trade-support-draft");if(saved)document.querySelector("#support-suggestion").value=saved;}catch(_){}
  window.addEventListener("hashchange",()=>show(location.hash.slice(1),false));
  show(location.hash.slice(1)||"dashboard",false);
  window.addEventListener("focus",syncStatus);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)syncStatus();});
})();