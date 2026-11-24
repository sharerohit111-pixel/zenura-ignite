import {NAV_ITEMS,findInstrument,getWatchlist,formatINR,formatSigned,validateDashboardData} from "./dashboard-model.js";

const $ = (selector, root=document) => root.querySelector(selector);
const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const state = {data:null,screen:"home",query:"",orderFilter:"ALL",segment:"ALL",language:"en",theme:"dark"};
const copy = {
  en:{home:"Home",market:"Market",watchlist:"Watchlist",orders:"Orders",portfolio:"Portfolio",positions:"Positions",holdings:"Holdings",profile:"Profile",settings:"Settings",
    overview:"Market overview",dayPnl:"Today's P&L",totalPnl:"Total P&L",available:"Available cash",invested:"Invested value",indices:"Indian indices",quick:"Quick access",topMovers:"Market watch",
    search:"Search symbol or company",all:"All",equity:"Equity",futures:"Futures",options:"Options",symbol:"Instrument",ltp:"Last price",change:"Change",volume:"Volume",exchange:"Exchange",
    orderBook:"Order book",allOrders:"All orders",filled:"Filled",pending:"Pending",cancelled:"Cancelled",time:"Time",side:"Side",product:"Product",type:"Type",qty:"Qty",price:"Price",status:"Status",
    accountValue:"Total account value",performance:"Portfolio performance",allocation:"Capital allocation",holdingsValue:"Holdings value",positionsValue:"Open positions",holdings:"Holdings",
    positionBook:"Open positions",avg:"Average price",pnl:"P&L",name:"Name",email:"Email",demoProfile:"Demo profile",preferences:"Preferences",language:"Language",appearance:"Appearance",dark:"Dark theme",light:"Light theme",alerts:"Price alerts (demo)",privacy:"Privacy",disclaimer:"All figures on this dashboard are illustrative dummy data. No live market feed, broker API, real account or real order execution is connected.",
    demo:"DEMO DATA",marketClosed:"SIMULATED SESSION",noRows:"No records match this filter.",addWatch:"Add to watchlist",removeWatch:"Remove from watchlist",watchEmpty:"Your watchlist is empty. Add instruments from Market.",
    capital:"Virtual starting capital",account:"Account",settingsNote:"These preferences affect this demo dashboard only.",marketNote:"Prices and index values below are sample figures for interface testing only.",
    viewMarket:"Explore market",viewOrders:"View orders",viewPortfolio:"Open portfolio",equityHoldings:"Equity holdings",derivatives:"Derivatives",total:"Total"
  },
  hi:{home:"होम",market:"मार्केट",watchlist:"वॉचलिस्ट",orders:"ऑर्डर",portfolio:"पोर्टफोलियो",positions:"पोज़िशन",holdings:"होल्डिंग",profile:"प्रोफ़ाइल",settings:"सेटिंग्स",
    overview:"मार्केट अवलोकन",dayPnl:"आज का P&L",totalPnl:"कुल P&L",available:"उपलब्ध नकद",invested:"निवेशित मूल्य",indices:"भारतीय सूचकांक",quick:"त्वरित पहुँच",topMovers:"मार्केट वॉच",
    search:"सिंबल या कंपनी खोजें",all:"सभी",equity:"इक्विटी",futures:"फ्यूचर्स",options:"ऑप्शंस",symbol:"इंस्ट्रूमेंट",ltp:"अंतिम भाव",change:"बदलाव",volume:"वॉल्यूम",exchange:"एक्सचेंज",
    orderBook:"ऑर्डर बुक",allOrders:"सभी ऑर्डर",filled:"पूरे हुए",pending:"लंबित",cancelled:"रद्द",time:"समय",side:"साइड",product:"प्रोडक्ट",type:"प्रकार",qty:"मात्रा",price:"भाव",status:"स्थिति",
    accountValue:"कुल अकाउंट मूल्य",performance:"पोर्टफोलियो प्रदर्शन",allocation:"कैपिटल विभाजन",holdingsValue:"होल्डिंग मूल्य",positionsValue:"ओपन पोज़िशन",holdings:"होल्डिंग",
    positionBook:"ओपन पोज़िशन",orders:"ऑर्डर",positions:"पोज़िशन",blockedFunds:"ब्लॉक फंड",avg:"औसत भाव",pnl:"P&L",name:"नाम",email:"ईमेल",demoProfile:"डेमो प्रोफ़ाइल",preferences:"प्राथमिकताएँ",language:"भाषा",appearance:"दिखावट",dark:"डार्क थीम",light:"लाइट थीम",alerts:"प्राइस अलर्ट (डेमो)",privacy:"गोपनीयता",disclaimer:"इस डैशबोर्ड के सभी आँकड़े केवल उदाहरण हेतु डमी डेटा हैं। कोई लाइव मार्केट फीड, ब्रोकर API, वास्तविक अकाउंट या वास्तविक ऑर्डर निष्पादन जुड़ा नहीं है।",
    demo:"डेमो डेटा",marketClosed:"सिम्युलेटेड सत्र",noRows:"इस फ़िल्टर में कोई रिकॉर्ड नहीं है।",addWatch:"वॉचलिस्ट में जोड़ें",removeWatch:"वॉचलिस्ट से हटाएँ",watchEmpty:"वॉचलिस्ट खाली है। मार्केट से इंस्ट्रूमेंट जोड़ें।",
    capital:"वर्चुअल शुरुआती पूंजी",account:"अकाउंट",settingsNote:"ये प्राथमिकताएँ केवल इस डेमो डैशबोर्ड पर लागू होंगी।",marketNote:"नीचे दिए गए भाव और सूचकांक केवल UI परीक्षण हेतु उदाहरण हैं।",
    viewMarket:"मार्केट देखें",viewOrders:"ऑर्डर देखें",viewPortfolio:"पोर्टफोलियो खोलें",equityHoldings:"इक्विटी होल्डिंग",derivatives:"डेरिवेटिव्स",total:"कुल"
  }
};
const t = key => copy[state.language][key] || key;
const money = value => formatINR(value);
const signClass = value => Number(value)>=0 ? "positive" : "negative";
const signMoney = value => formatSigned(value);
const instrumentRow = (item, showVolume=true) => `<tr><td><strong>${escapeHTML(item.symbol)}</strong><small>${escapeHTML(item.name)}</small></td><td>${escapeHTML(item.exchange)}</td><td class="num">${money(item.price)}</td><td class="num ${signClass(item.change)}">${signMoney(item.change)} <small>(${signMoney(item.changePercent,"%")})</small></td>${showVolume?`<td class="num muted">${escapeHTML(item.volume)}</td>`:""}<td><button class="icon-button watch-toggle" data-symbol="${escapeHTML(item.symbol)}" aria-label="${state.data.watchlist.includes(item.symbol)?t("removeWatch"):t("addWatch")}">${state.data.watchlist.includes(item.symbol)?"★":"☆"}</button></td></tr>`;
const table = (headers, rows, empty=t("noRows")) => `<div class="table-wrap"><table><thead><tr>${headers.map(x=>`<th>${x}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="empty-cell">${empty}</td></tr>`}</tbody></table></div>`;
const metric = (label,value,sub="",cls="") => `<article class="metric"><span>${label}</span><strong class="${cls}">${value}</strong><small>${sub}</small></article>`;
const chart = () => {
  const values=state.data.performance.map(x=>x.value),min=Math.min(...values)-15000,max=Math.max(...values)+15000;
  const points=values.map((v,i)=>`${24+i* (552/(values.length-1))},${138-(v-min)/(max-min)*112}`).join(" ");
  return `<svg class="performance-chart" viewBox="0 0 600 160" role="img" aria-label="Illustrative portfolio performance chart"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#31d6b0" stop-opacity=".28"/><stop offset="1" stop-color="#31d6b0" stop-opacity="0"/></linearGradient></defs><path d="M24 138 ${points.replaceAll(" ", " L")} L576 150 L24 150 Z" fill="url(#chartFill)"/><polyline points="${points}" fill="none" stroke="#38d9b3" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${values.map((v,i)=>`<text x="${24+i* (552/(values.length-1))}" y="158" text-anchor="middle">${escapeHTML(state.data.performance[i].label)}</text>`).join("")}</svg>`;
};
function pageHeader(title,sub,action=""){return `<div class="page-heading"><div><div class="eyebrow">ZENURA IGNITE / S-TRADE</div><h1>${title}</h1><p>${sub}</p></div>${action}</div>`;}
function homeView(){
 const a=state.data.account;
 const movers=[...state.data.instruments].sort((x,y)=>y.changePercent-x.changePercent).slice(0,5);
 return `${pageHeader(t("overview"),t("marketNote"),'<span class="session-pill">● '+t("marketClosed")+'</span>')}
 <div class="metric-grid">${metric(t("accountValue"),money(a.totalValue),t("capital")+": "+money(a.virtualCapital))}${metric(t("dayPnl"),money(a.dayPnl),"+0.76% today","positive")}${metric(t("totalPnl"),money(a.totalPnl),"+"+a.pnlPercent+"% overall","positive")}${metric(t("available"),money(a.availableCash),t("invested")+": "+money(a.investedValue))}</div>
 <div class="content-grid"><section class="panel"><div class="panel-title"><div><span class="eyebrow">NSE · BSE</span><h2>${t("indices")}</h2></div><span class="live-tag">DEMO</span></div><div class="index-grid">${state.data.indices.map(i=>`<div class="index-card"><small>${escapeHTML(i.exchange)}</small><b>${escapeHTML(i.symbol)}</b><strong>${money(i.price)}</strong><span class="${signClass(i.change)}">${signMoney(i.change)} (${signMoney(i.changePercent,"%")})</span></div>`).join("")}</div></section>
 <section class="panel"><div class="panel-title"><div><span class="eyebrow">DEMO ACCOUNT</span><h2>${t("quick")}</h2></div></div><div class="quick-links"><button data-go="market">▥ <span>${t("viewMarket")}</span><b>→</b></button><button data-go="orders">⇄ <span>${t("viewOrders")}</span><b>→</b></button><button data-go="portfolio">◫ <span>${t("viewPortfolio")}</span><b>→</b></button></div><p class="helper-note">${t("disclaimer")}</p></section></div>
 <section class="panel"><div class="panel-title"><div><span class="eyebrow">TOP MOVERS · SAMPLE</span><h2>${t("topMovers")}</h2></div><button class="text-button" data-go="market">${t("viewMarket")} →</button></div>${table([t("symbol"),t("exchange"),t("ltp"),t("change"),t("volume"),""],movers.map(item=>instrumentRow(item)).join(""))}</section>`;
}
function marketView(watchOnly=false){
 const items=watchOnly?getWatchlist(state.data):state.data.instruments.filter(x=>state.segment==="ALL"||x.segment.toUpperCase()===state.segment);
 const filtered=items.filter(x=>(x.symbol+" "+x.name).toLowerCase().includes(state.query.toLowerCase()));
 const tabs=[["ALL",t("all")],["EQUITY",t("equity")],["FUTURES",t("futures")],["OPTIONS",t("options")]];
 return `${pageHeader(watchOnly?t("watchlist"):t("market"),t("marketNote"))}
 <section class="panel"><div class="market-controls"><label class="search-box"><span>⌕</span><input id="market-search" value="${escapeHTML(state.query)}" placeholder="${t("search")}"></label>${watchOnly?"":`<div class="segmented">${tabs.map(([id,label])=>`<button data-segment="${id}" class="${state.segment===id?"active":""}">${label}</button>`).join("")}</div>`}</div>
 ${watchOnly&&filtered.length===0?`<div class="empty-state">☆<p>${t("watchEmpty")}</p><button class="primary-button" data-go="market">${t("viewMarket")}</button></div>`:table([t("symbol"),t("exchange"),t("ltp"),t("change"),t("volume"),""],filtered.map(item=>instrumentRow(item)).join(""))}</section>`;
}
function ordersView(){
 const all=state.data.orders,filtered=all.filter(x=>state.orderFilter==="ALL"||x.status===state.orderFilter);
 return `${pageHeader(t("orderBook"),"Demo order records · No broker connection")}
 <section class="panel"><div class="market-controls"><div class="segmented">${[["ALL",t("allOrders")],["FILLED",t("filled")],["PENDING",t("pending")],["CANCELLED",t("cancelled")]].map(([id,label])=>`<button data-order-filter="${id}" class="${state.orderFilter===id?"active":""}">${label}</button>`).join("")}</div><span class="count-pill">${filtered.length} ${t("orders")}</span></div>
 ${table([t("time"),"Order ID",t("symbol"),t("side"),t("product"),t("type"),t("qty"),t("price"),t("status")],filtered.map(o=>`<tr><td>${escapeHTML(o.time)}</td><td class="muted">${escapeHTML(o.id)}</td><td><strong>${escapeHTML(o.symbol)}</strong></td><td class="${o.side==="BUY"?"positive":"negative"}">${o.side}</td><td>${escapeHTML(o.product)}</td><td>${escapeHTML(o.type)}</td><td class="num">${o.quantity}</td><td class="num">${money(o.price)}</td><td><span class="status ${o.status.toLowerCase()}">${escapeHTML(o.status)}</span></td></tr>`).join(""))}</section>`;
}
function portfolioView(){
 const a=state.data.account;
 return `${pageHeader(t("portfolio"),"Virtual capital and illustrative performance")}
 <div class="metric-grid">${metric(t("accountValue"),money(a.totalValue),"Virtual account")}${metric(t("available"),money(a.availableCash),t("blockedFunds")+": "+money(a.blockedFunds))}${metric(t("holdingsValue"),money(a.investedValue),t("equityHoldings"))}${metric(t("totalPnl"),money(a.totalPnl),"+"+a.pnlPercent+"%","positive")}</div>
 <div class="content-grid"><section class="panel"><div class="panel-title"><div><span class="eyebrow">7-DAY SAMPLE</span><h2>${t("performance")}</h2></div><span class="positive">+${a.pnlPercent}%</span></div>${chart()}</section><section class="panel"><div class="panel-title"><div><span class="eyebrow">VIRTUAL CAPITAL</span><h2>${t("allocation")}</h2></div></div><div class="allocation"><div><span>Available cash</span><b>${money(a.availableCash)}</b></div><div class="allocation-track"><i style="width:${a.availableCash/a.totalValue*100}%"></i></div><div><span>Invested / reserved</span><b>${money(a.investedValue+a.blockedFunds)}</b></div><div class="allocation-track"><i class="invested" style="width:${(a.investedValue+a.blockedFunds)/a.totalValue*100}%"></i></div><small>Illustrative allocation only</small></div></section></div>
 <section class="panel"><div class="panel-title"><h2>${t("holdingsValue")}</h2><button class="text-button" data-go="holdings">${t("holdings")} →</button></div>${table([t("symbol"),t("qty"),t("avg"),t("ltp"),t("pnl")],state.data.holdings.map(h=>`<tr><td><strong>${h.symbol}</strong><small>${h.name}</small></td><td class="num">${h.quantity}</td><td class="num">${money(h.avgPrice)}</td><td class="num">${money(h.ltp)}</td><td class="num positive">${money(h.pnl)}</td></tr>`).join(""))}</section>`;
}
function positionsView(){
 return `${pageHeader(t("positionBook"),"Futures and long Options · Simulated values")}
 <section class="panel">${table([t("symbol"),"Segment",t("side"),t("product"),t("qty"),t("avg"),t("ltp"),t("pnl")],state.data.positions.map(p=>`<tr><td><strong>${escapeHTML(p.symbol)}</strong><small>${escapeHTML(p.name)}</small></td><td>${escapeHTML(p.kind)}</td><td class="${p.side==="LONG"?"positive":"negative"}">${p.side}</td><td>${p.product}</td><td class="num">${p.quantity}</td><td class="num">${money(p.avgPrice)}</td><td class="num">${money(p.ltp)}</td><td class="num ${signClass(p.pnl)}">${money(p.pnl)}</td></tr>`).join(""))}</section>`;
}
function holdingsView(){
 return `${pageHeader(t("holdings"),"Delivery equity holdings · Sample ledger view")}
 <section class="panel">${table([t("symbol"),t("name"),t("qty"),t("avg"),t("ltp"),"Invested","Value",t("pnl")],state.data.holdings.map(h=>`<tr><td><strong>${h.symbol}</strong></td><td>${escapeHTML(h.name)}</td><td class="num">${h.quantity}</td><td class="num">${money(h.avgPrice)}</td><td class="num">${money(h.ltp)}</td><td class="num">${money(h.invested)}</td><td class="num">${money(h.value)}</td><td class="num ${signClass(h.pnl)}">${money(h.pnl)}<small>(${signMoney(h.pnlPercent,"%")})</small></td></tr>`).join(""))}</section>`;
}
function profileView(){
 const a=state.data.account;
 return `${pageHeader(t("profile"),t("demoProfile"))}<section class="panel profile-card"><div class="avatar">PT</div><div><span class="eyebrow">PAPER TRADING ACCOUNT</span><h2>${escapeHTML(a.name)}</h2><p>${escapeHTML(a.email)}</p><span class="status filled">DEMO ACCOUNT</span></div></section><section class="panel"><div class="panel-title"><h2>${t("account")}</h2></div><div class="detail-grid"><div><small>${t("name")}</small><b>${escapeHTML(a.name)}</b></div><div><small>${t("email")}</small><b>${escapeHTML(a.email)}</b></div><div><small>${t("capital")}</small><b>${money(a.virtualCapital)}</b></div><div><small>Account type</small><b>Indian Market · Paper Trading</b></div></div></section>`;
}
function settingsView(){
 return `${pageHeader(t("settings"),t("settingsNote"))}<section class="panel settings-panel"><div class="panel-title"><div><span class="eyebrow">DISPLAY</span><h2>${t("preferences")}</h2></div></div><div class="setting-row"><div><b>${t("appearance")}</b><small>${state.theme==="dark"?t("dark"):t("light")}</small></div><button id="theme-setting" class="toggle ${state.theme==="light"?"on":""}" role="switch" aria-checked="${state.theme==="light"}"><i></i></button></div><div class="setting-row"><div><b>${t("language")}</b><small>English / हिन्दी</small></div><button id="language-setting" class="outline-button">${state.language==="en"?"हिन्दी":"English"}</button></div><div class="setting-row"><div><b>${t("alerts")}</b><small>Sample preference · no notifications sent</small></div><button id="alert-setting" class="toggle" role="switch" aria-checked="false"><i></i></button></div></section><section class="panel"><div class="panel-title"><div><span class="eyebrow">DATA & SAFETY</span><h2>${t("privacy")}</h2></div></div><p class="helper-note">${t("disclaimer")}</p><div class="demo-source">DATA SOURCE <strong>DUMMY JSON · LOCAL FIXTURE</strong><span>As of ${escapeHTML(state.data.meta.asOf)} IST</span></div></section>`;
}
const views={home:homeView,market:()=>marketView(false),watchlist:()=>marketView(true),orders:ordersView,portfolio:portfolioView,positions:positionsView,holdings:holdingsView,profile:profileView,settings:settingsView};
function render(){
 const screen=views[state.screen]?state.screen:"home";
 $("#screen-title").textContent=t(screen);
 $("#sidebar-nav").innerHTML=NAV_ITEMS.map(([id,label,icon])=>`<button data-screen="${id}" class="nav-item ${screen===id?"active":""}" ${screen===id?'aria-current="page"':""}><span class="nav-icon">${icon}</span><span>${t(id)}</span>${id==="orders"?'<i class="nav-count">2</i>':""}</button>`).join("");
 $("#mobile-nav").innerHTML=NAV_ITEMS.map(([id,label,icon])=>`<button data-screen="${id}" class="${screen===id?"active":""}"><span>${icon}</span><small>${t(id)}</small></button>`).join("");
 $("#view").innerHTML=views[screen]();
 document.body.dataset.theme=state.theme;
 $("#language-toggle").textContent=state.language==="en"?"हिन्दी":"English";
 $("#demo-asof").textContent=new Date(state.data.meta.asOf).toLocaleString(state.language==="hi"?"hi-IN":"en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"})+" IST";
}
function navigate(screen){if(!views[screen])return;state.screen=screen;state.query="";state.segment="ALL";state.orderFilter="ALL";history.replaceState(null,"","#"+screen);render();window.scrollTo({top:0,behavior:"smooth"});}
document.addEventListener("click",event=>{
 const nav=event.target.closest("[data-screen],[data-go]");
 if(nav){navigate(nav.dataset.screen||nav.dataset.go);return;}
 const segment=event.target.closest("[data-segment]");if(segment){state.segment=segment.dataset.segment;render();return;}
 const filter=event.target.closest("[data-order-filter]");if(filter){state.orderFilter=filter.dataset.orderFilter;render();return;}
 const watch=event.target.closest(".watch-toggle");if(watch){const symbol=watch.dataset.symbol;state.data.watchlist=state.data.watchlist.includes(symbol)?state.data.watchlist.filter(x=>x!==symbol):[...state.data.watchlist,symbol];render();return;}
 if(event.target.closest("#theme-setting")){state.theme=state.theme==="dark"?"light":"dark";localStorage.setItem("zenura-dashboard-theme",state.theme);render();return;}
 if(event.target.closest("#language-setting")||event.target.closest("#language-toggle")){state.language=state.language==="en"?"hi":"en";localStorage.setItem("zenura-dashboard-language",state.language);render();return;}
 if(event.target.closest("#alert-setting")){const b=$("#alert-setting");const on=b.getAttribute("aria-checked")!=="true";b.setAttribute("aria-checked",String(on));b.classList.toggle("on",on);}
});
document.addEventListener("input",event=>{if(event.target.id==="market-search"){const start=event.target.selectionStart;state.query=event.target.value;const cursor=event.target.id;const table=marketView(state.screen==="watchlist");$("#view").innerHTML=table;const input=$("#market-search");input?.focus();input?.setSelectionRange(start,start);}});
async function init(){
 state.theme=localStorage.getItem("zenura-dashboard-theme")==="light"?"light":"dark";
 state.language=localStorage.getItem("zenura-dashboard-language")==="hi"?"hi":"en";
 try{const response=await fetch("./mock-data.json",{cache:"no-store"});if(!response.ok)throw new Error("Dummy data file unavailable.");state.data=validateDashboardData(await response.json());}
 catch(error){$("#view").innerHTML=`<section class="panel error-state"><h2>Dashboard data unavailable</h2><p>${escapeHTML(error.message)}</p></section>`;return;}
 const requested=location.hash.slice(1);state.screen=views[requested]?requested:"home";render();
}
init();
