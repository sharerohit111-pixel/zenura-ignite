import { createPaperDemoViewModel, searchPaperDemoInstruments, getPaperDemoExpiries, getPaperDemoOptionChain } from "../shared/paper-demo-adapter.mjs";
import { mountDerivativeDemo, appendDerivativeSummary } from "./demo-derivative-panel.mjs";
import { mountDemoChart } from "./demo-chart-panel.mjs";
import { mountEquityDemo, appendEquitySummary } from "./demo-equity-panel.mjs";
import { mountPrivateWatchlists } from "./demo-watchlist-persistence.mjs";

"use strict";
const status=document.getElementById("demo-status");
const content=document.getElementById("screen-content");
const nav=document.getElementById("screen-nav");
const screens=["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"];
const titles={home:"Home Overview",market:"Market Snapshot",watchlists:"Watchlists",charts:"Charts & Depth",equity:"Equity Paper Trading",futures:"Futures Paper Trading",options:"Options Paper Trading",orders:"Orders",trades:"Trade History",portfolio:"Portfolio",positions:"Positions",holdings:"Holdings",account:"Virtual Wallet",profile:"Demo Profile",settings:"Settings"};
let model=null;
let demoWatchlists=null;
let privateWatchlistPanel=null;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
const money=paise=>"₹"+(Number(paise||0)/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const card=(label,value,detail)=>{const c=el("article","card");c.append(el("h3","",label),el("div","metric",value),el("div","sub",detail||""));return c;};
const grid=(...items)=>{const g=el("div","grid");items.forEach(x=>g.append(x));return g;};
const table=(headers,rows)=>{const wrap=el("div","table-wrap"),t=el("table"),head=el("thead"),hr=el("tr"),body=el("tbody");wrap.tabIndex=0;wrap.setAttribute("role","region");wrap.setAttribute("aria-label","Scrollable data table");headers.forEach(h=>{const th=el("th","",h);th.scope="col";hr.append(th);});head.append(hr);rows.forEach(row=>{const tr=el("tr");row.forEach(v=>tr.append(el("td","",v??"—")));body.append(tr);});if(!rows.length){const tr=el("tr"),td=el("td","empty","No record exists in the current canonical fixture.");td.colSpan=headers.length;tr.append(td);body.append(tr);}t.append(head,body);wrap.append(t);return wrap;};
const notice=text=>el("div","notice",text);
function header(name,description){const row=el("div","screen-title"),left=el("div");left.append(el("h2","",titles[name]||name),el("p","",description));row.append(left,el("span","read-only","MOCK · LOCAL DEMO"));return row;}
function quoteRows(){return model.market.instruments.map(x=>[x.symbol,x.exchange,x.assetClass,money(x.lastPricePaise),(x.changePaise>=0?"+":"")+money(x.changePaise),x.volume,x.timestamp]);}
function field(label,control){const wrap=el("label","catalog-field");wrap.append(el("span","",label),control);return wrap;}
function selectControl(id,options){const select=el("select");select.id=id;options.forEach(([value,label])=>{const option=el("option","",label);option.value=value;select.append(option);});return select;}
function uniqueValues(items,key){return [...new Set(items.map(x=>x[key]).filter(Boolean))].sort();}
function renderInstrumentCatalog(host,{assetClass=""}={}){
 const controls=el("div","catalog-controls"),query=el("input");query.type="search";query.placeholder="Search MOCK symbol or underlying";query.setAttribute("aria-label","Search demo instruments");
 const exchange=selectControl("catalog-exchange",[["","All exchanges"],["NSE","NSE"],["BSE","BSE"]]);
 const kind=selectControl("catalog-kind",[["","All instruments"],["EQUITY","Equity"],["INDEX","Indices"],["FUTURE","Futures"],["OPTION","Options"]]);kind.value=assetClass;
 controls.append(field("Search",query),field("Exchange",exchange),field("Asset class",kind));
 const tableHost=el("div","catalog-results"),status=el("p","sub","");host.append(controls,status,tableHost);
 function update(){
  const rows=searchPaperDemoInstruments(model,{query:query.value,exchange:exchange.value,assetClass:kind.value});
  status.textContent=rows.length+" MOCK instruments · filtered locally from canonical fixtures";
  tableHost.replaceChildren(table(["SYMBOL","EXCHANGE","TYPE","UNDERLYING","EXPIRY","STRIKE","SAMPLE PRICE","BID / ASK"],rows.map(x=>[
   x.symbol,x.exchange,x.assetClass,x.underlying,x.expiry||"—",x.strikePaise?money(x.strikePaise):"—",money(x.lastPricePaise),
   x.bidPricePaise===null?"—":money(x.bidPricePaise)+" / "+money(x.askPricePaise)
  ])));
 }
 [query,exchange,kind].forEach(control=>control.addEventListener("input",update));
 [exchange,kind].forEach(control=>control.addEventListener("change",update));
 update();
}
function renderFuturesCatalog(host){
 const contracts=model.market.instruments.filter(x=>x.assetClass==="FUTURE");
 const underlyings=uniqueValues(contracts,"underlying"),underlying=selectControl("futures-underlying",[...underlyings.map(x=>[x,x]),["","All underlyings"]]);
 const exchange=selectControl("futures-exchange",[["","All exchanges"],["NSE","NSE"],["BSE","BSE"]]);
 const expiry=selectControl("futures-expiry",[["","All expiries"]]);
 const query=el("input");query.type="search";query.placeholder="Search Futures contract";
 const controls=el("div","catalog-controls");controls.append(field("Underlying",underlying),field("Exchange",exchange),field("Expiry",expiry),field("Search",query));
 const hostTable=el("div","catalog-results"),status=el("p","sub","");host.append(controls,status,hostTable);
 function refreshExpiries(){const dates=[...new Set(contracts.filter(x=>(!underlying.value||x.underlying===underlying.value)&&(!exchange.value||x.exchange===exchange.value)).map(x=>x.expiry))].sort();const previous=expiry.value;expiry.replaceChildren(selectControl("unused",[["","All expiries"]]).firstChild);dates.forEach(x=>{const o=el("option","",x);o.value=x;expiry.append(o);});if(dates.includes(previous))expiry.value=previous;}
 function update(){const rows=searchPaperDemoInstruments(model,{query:query.value,assetClass:"FUTURE",underlying:underlying.value,exchange:exchange.value,expiry:expiry.value});status.textContent=rows.length+" MOCK Futures contracts";hostTable.replaceChildren(table(["CONTRACT","EXCHANGE","UNDERLYING","EXPIRY","LOT SIZE","BID","ASK"],rows.map(x=>[x.symbol,x.exchange,x.underlying,x.expiry,x.lotSize,money(x.bidPricePaise),money(x.askPricePaise)])));}
 underlying.addEventListener("change",()=>{refreshExpiries();update();});exchange.addEventListener("change",()=>{refreshExpiries();update();});expiry.addEventListener("change",update);query.addEventListener("input",update);refreshExpiries();update();
}
function renderOptionsCatalog(host){
 const contracts=model.market.instruments.filter(x=>x.assetClass==="OPTION");
 const underlyings=uniqueValues(contracts,"underlying");
 const underlying=selectControl("options-underlying",underlyings.map(x=>[x,x]));
 const exchange=selectControl("options-exchange",[["","All exchanges"],["NSE","NSE"],["BSE","BSE"]]);
 const expiry=selectControl("options-expiry",[]);
 const strike=selectControl("options-strike",[["","All strikes"]]);
 const side=selectControl("options-side",[["","CE + PE"],["CE","CE only"],["PE","PE only"]]);
 const query=el("input");query.type="search";query.placeholder="Search option symbol";
 const controls=el("div","catalog-controls");controls.append(field("Underlying",underlying),field("Exchange",exchange),field("Expiry",expiry),field("Strike",strike),field("Option side",side),field("Search",query));
 const status=el("p","sub",""),tableHost=el("div","catalog-results");host.append(controls,status,tableHost);
 function refreshExpiry(){
  const dates=getPaperDemoExpiries(model,{underlying:underlying.value,assetClass:"OPTION",exchange:exchange.value});
  const previous=expiry.value;expiry.replaceChildren();dates.forEach(x=>{const o=el("option","",x);o.value=x;expiry.append(o);});if(dates.includes(previous))expiry.value=previous;
  refreshStrikes();
 }
 function refreshStrikes(){
  const chain=getPaperDemoOptionChain(model,{underlying:underlying.value,expiry:expiry.value,exchange:exchange.value});
  const previous=strike.value;strike.replaceChildren();const all=el("option","","All strikes");all.value="";strike.append(all);
  chain.forEach(row=>{const o=el("option","",money(row.strikePaise));o.value=String(row.strikePaise);strike.append(o);});
  if([...strike.options].some(x=>x.value===previous))strike.value=previous;
 }
 function update(){
  if(!expiry.value){status.textContent="No listed synthetic option expiry for this selection.";tableHost.replaceChildren();return;}
  const chain=getPaperDemoOptionChain(model,{underlying:underlying.value,expiry:expiry.value,exchange:exchange.value,strikePaise:strike.value||undefined,optionType:side.value||undefined});
  const filtered=chain.filter(row=>{
   if(!query.value)return true;
   const q=query.value.toLowerCase();
   return [row.CE?.symbol,row.PE?.symbol,underlying.value].some(x=>String(x||"").toLowerCase().includes(q));
  });
  status.textContent=filtered.length+" strike rows · "+underlying.value+" · "+expiry.value+" · MOCK option chain";
  tableHost.replaceChildren(table(["STRIKE","CE CONTRACT","CE BID","CE ASK","PE CONTRACT","PE BID","PE ASK"],filtered.map(row=>[
   money(row.strikePaise),row.CE?.symbol||"—",row.CE?money(row.CE.bidPricePaise):"—",row.CE?money(row.CE.askPricePaise):"—",
   row.PE?.symbol||"—",row.PE?money(row.PE.bidPricePaise):"—",row.PE?money(row.PE.askPricePaise):"—"
  ])));
 }
 underlying.addEventListener("change",()=>{refreshExpiry();update();});exchange.addEventListener("change",()=>{refreshExpiry();update();});
 expiry.addEventListener("change",()=>{refreshStrikes();update();});strike.addEventListener("change",update);side.addEventListener("change",update);query.addEventListener("input",update);
 refreshExpiry();update();
}
function instrumentChangePercent(item){
 const previous=item.lastPricePaise-item.changePaise;
 return previous>0?item.changePaise/previous*100:0;
}
function renderMarketDashboard(host){
 const instruments=model.market.instruments;
 const indices=instruments.filter(x=>x.assetClass==="INDEX");
 const equities=instruments.filter(x=>x.assetClass==="EQUITY");
 const statuses=["NSE","BSE"].map(exchange=>card(exchange+" MOCK status",model.market.marketStatus||"—","Synthetic fixture status · not official"));
 host.append(grid(...statuses));
 host.append(el("h3","","Synthetic index snapshot"),table(["INDEX","EXCHANGE","SAMPLE LEVEL","CHANGE"],indices.map(x=>[x.symbol,x.exchange,money(x.lastPricePaise),(instrumentChangePercent(x).toFixed(2))+"%"])));
 const gainers=equities.slice().sort((a,b)=>instrumentChangePercent(b)-instrumentChangePercent(a)).slice(0,3);
 const losers=equities.slice().sort((a,b)=>instrumentChangePercent(a)-instrumentChangePercent(b)).slice(0,3);
 host.append(grid(card("Top synthetic gainers",gainers.map(x=>x.symbol+" "+instrumentChangePercent(x).toFixed(2)+"%").join(" · ")||"—","MOCK fixture only"),card("Top synthetic losers",losers.map(x=>x.symbol+" "+instrumentChangePercent(x).toFixed(2)+"%").join(" · ")||"—","MOCK fixture only")));
 const catalog=el("section","catalog-panel");host.append(catalog);renderInstrumentCatalog(catalog);
 host.append(notice("All indices, prices, movers and exchange statuses are synthetic MOCK values. They are not live NSE/BSE data or official exchange status."));
}
function initDemoWatchlists(){
 const all=model.market.instruments;
 const take=predicate=>all.filter(predicate).slice(0,50).map(x=>x.instrumentKey);
 demoWatchlists={
  "My Stocks":take(x=>x.assetClass==="EQUITY"),
  "Indices":take(x=>x.assetClass==="INDEX"),
  "Futures":take(x=>x.assetClass==="FUTURE"),
  "Options":take(x=>x.assetClass==="OPTION")
 };
}
function renderDemoWatchlists(host){
 if(!demoWatchlists)initDemoWatchlists();
 const names=Object.keys(demoWatchlists);
 const listSelect=selectControl("demo-watchlist-select",names.map(x=>[x,x]));
 const instrumentSelect=selectControl("demo-watchlist-instrument",model.market.instruments.map(x=>[x.instrumentKey,x.symbol+" · "+x.exchange+" · "+x.assetClass]));
 const addButton=el("button","catalog-add","ADD TO WATCHLIST");addButton.type="button";
 const controls=el("div","catalog-controls");
 controls.append(field("Watchlist",listSelect),field("Add MOCK instrument",instrumentSelect),addButton);
 const status=el("p","sub",""),rowsHost=el("div","catalog-results");
 host.append(controls,status,rowsHost);
 function renderRows(){
  const list=demoWatchlists[listSelect.value]||[];
  const present=new Set(list);
  [...instrumentSelect.options].forEach(option=>{option.disabled=present.has(option.value);});
  addButton.disabled=!instrumentSelect.value||present.has(instrumentSelect.value)||list.length>=50;
  status.textContent=list.length+" / 50 instruments · current-page memory only · no account/database writes";
  const rows=list.map((key,index)=>{
   const item=model.market.instruments.find(x=>x.instrumentKey===key);
   if(!item)return null;
   return [item.symbol,item.exchange,item.assetClass,money(item.lastPricePaise),
    index>0?"↑":"—",index<list.length-1?"↓":"—","REMOVE"];
  }).filter(Boolean);
  const wrap=el("div","table-wrap"),tableNode=el("table"),head=el("thead"),hr=el("tr"),body=el("tbody");wrap.tabIndex=0;wrap.setAttribute("role","region");wrap.setAttribute("aria-label","Scrollable demo watchlist");
  ["SYMBOL","EXCHANGE","TYPE","MOCK PRICE","UP","DOWN","REMOVE"].forEach(x=>hr.append(el("th","",x)));head.append(hr);
  if(!rows.length){const tr=el("tr"),td=el("td","empty","This demo watchlist is empty.");td.colSpan=7;tr.append(td);body.append(tr);}
  list.forEach((key,index)=>{
   const item=model.market.instruments.find(x=>x.instrumentKey===key);if(!item)return;
   const tr=el("tr");
   [item.symbol,item.exchange,item.assetClass,money(item.lastPricePaise)].forEach(x=>tr.append(el("td","",x)));
   const upCell=el("td"),up=el("button","catalog-action","↑");up.type="button";up.disabled=index===0;up.setAttribute("aria-label","Move "+item.symbol+" up");up.addEventListener("click",()=>{const arr=demoWatchlists[listSelect.value];[arr[index-1],arr[index]]=[arr[index],arr[index-1]];renderRows();});upCell.append(up);tr.append(upCell);
   const downCell=el("td"),down=el("button","catalog-action","↓");down.type="button";down.disabled=index===list.length-1;down.setAttribute("aria-label","Move "+item.symbol+" down");down.addEventListener("click",()=>{const arr=demoWatchlists[listSelect.value];[arr[index],arr[index+1]]=[arr[index+1],arr[index]];renderRows();});downCell.append(down);tr.append(downCell);
   const removeCell=el("td"),remove=el("button","catalog-action","REMOVE");remove.type="button";remove.addEventListener("click",()=>{demoWatchlists[listSelect.value]=demoWatchlists[listSelect.value].filter(x=>x!==key);renderRows();});removeCell.append(remove);tr.append(removeCell);body.append(tr);
  });
  tableNode.append(head,body);wrap.append(tableNode);rowsHost.replaceChildren(wrap);
 }
 listSelect.addEventListener("change",renderRows);
 instrumentSelect.addEventListener("change",renderRows);
 addButton.addEventListener("click",()=>{const list=demoWatchlists[listSelect.value],key=instrumentSelect.value;if(!key||list.length>=50||list.includes(key))return;list.push(key);renderRows();});
 renderRows();
 privateWatchlistPanel?.dispose?.();
 privateWatchlistPanel=mountPrivateWatchlists(host,{model});
}
function orderRows(orders){return orders.map(o=>[o.orderId,o.assetClass,o.instrumentKey,o.side,o.orderType,o.quantity??o.lots,o.status,money(o.averagePricePaise??o.limitPricePaise??0),money(o.chargesPaise??0)]);}
function render(name){
 const a=model.account,equity=model.positions.find(x=>x.assetClass==="EQUITY"),orders=model.orders;
 content.replaceChildren(header(name,"Illustrative values from one validated, versioned Mock JSON view model. Not live exchange data."));
 if(name==="home"){
  content.append(grid(card("Virtual starting capital",money(a.startingCapitalPaise),"₹10,00,000 synthetic account"),card("Available funds",money(a.availableFundsPaise),"Fixture snapshot"),card("Instruments",String(model.market.instruments.length),"NSE/BSE MOCK symbols"),card("Sample orders",String(orders.length),"Read-only records")));
  content.append(el("h3","","Synthetic market snapshot"),table(["SYMBOL","EXCHANGE","ASSET","SAMPLE PRICE","CHANGE","VOLUME","AS OF"],quoteRows()));
  return;
 }
 if(name==="market"){
  content.append(grid(card("Market status",model.market.marketStatus||"—","Simulated fixture status"),card("MOCK instruments",String(model.market.instruments.length),"Canonical shared catalog"),card("Exchanges","NSE + BSE","Synthetic identities only"),card("As of",model.asOf,"Fixed fixture timestamp")));
  renderMarketDashboard(content);
  return;
 }
 if(name==="watchlists"){
  content.append(notice("Demo watchlists are session-only and use the canonical MOCK instrument catalog. They never read or write private account watchlists."));
  renderDemoWatchlists(content);
  return;
 }
 if(name==="charts"){
  const chart=el("section","demo-market-panel");content.append(chart);mountDemoChart(chart);
  return;
 }
 if(name==="equity"){
  mountEquityDemo(content);
  return;
 }
 if(name==="futures"||name==="options"){
  const x=name==="futures"?model.derivatives.futures:model.derivatives.options;
  const order=orders.find(o=>o.assetClass===(name==="futures"?"FUTURE":"OPTION"));
  content.append(grid(card("Available contracts",String(model.market.instruments.filter(i=>i.assetClass===(name==="futures"?"FUTURE":"OPTION")).length),"NSE + BSE MOCK catalog"),card("Sample contract",x.symbol||x.underlying,"Order receipt fixture"),card("Expiry choices",String(getPaperDemoExpiries(model,{underlying:name==="futures"?"MOCKNIFTY":x.underlying,assetClass:name==="futures"?"FUTURE":"OPTION"}).length),"Deterministic fixture dates"),card("Order record",order?.status||"—","Read-only sample")));
  const catalog=el("section","catalog-panel");content.append(catalog);if(name==="futures")renderFuturesCatalog(catalog);else renderOptionsCatalog(catalog);
  content.append(table(["ORDER ID","INSTRUMENT","SIDE","TYPE","SIZE","STATUS","AVG / LIMIT"],orderRows(order?[order]:[])));
  content.append(notice("Contracts, strikes and quotes are synthetic MOCK fixtures. The local simulator below is browser-memory only; no production order API or broker connection is called."));
  mountDerivativeDemo(content,name);
  return;
 }
 if(name==="orders"||name==="trades"){
  const selected=name==="trades"?orders.filter(o=>o.status==="FILLED"):orders;
  content.append(grid(card("Records",String(selected.length),"Current fixture only"),card("Filled",String(selected.filter(o=>o.status==="FILLED").length),"Sample statuses"),card("Pending",String(selected.filter(o=>o.status==="PENDING"||o.status==="PARTIALLY_FILLED").length),"No worker runs"),card("Cancelled",String(selected.filter(o=>o.status==="CANCELLED").length),"No cancellation action")));
  content.append(table(["ORDER ID","ASSET","INSTRUMENT","SIDE","TYPE","SIZE","STATUS","AVG / LIMIT","CHARGES"],orderRows(selected)));
  appendEquitySummary(content,name);
  appendDerivativeSummary(content,name);
  return;
 }
 if(name==="portfolio"||name==="positions"||name==="holdings"){
  content.append(grid(card("Starting capital",money(a.startingCapitalPaise),"Virtual only"),card("Available funds",money(a.availableFundsPaise),"Fixture snapshot"),card("Blocked funds",money(a.blockedFundsPaise),"Fixture snapshot"),card("Unrealized P&L",money(a.unrealizedPnlPaise),"Account fixture")));
  content.append(table(["ASSET","INSTRUMENT","QUANTITY","AVERAGE PRICE","INVESTED VALUE","REALIZED P&L","UNREALIZED P&L"],model.positions.map(p=>[p.assetClass,p.instrumentKey,p.quantity,money(p.averagePricePaise),money(p.investedValuePaise),money(p.realizedPnlPaise),money(p.unrealizedPnlPaise)])));
  content.append(notice("The account fixture remains unreconciled. Local F&O Demo positions below are browser-memory only and do not update the wallet or unified ledger."));
  appendEquitySummary(content,name);
  if(name==="positions"||name==="portfolio") appendDerivativeSummary(content,name);
  return;
 }
 if(name==="account"){
  content.append(grid(card("Starting capital",money(a.startingCapitalPaise),"₹10,00,000 virtual capital"),card("Cash balance",money(a.cashBalancePaise),"Fixture value"),card("Blocked funds",money(a.blockedFundsPaise),"Fixture value"),card("Available funds",money(a.availableFundsPaise),"Fixture value")));
  content.append(notice("Ledger reconciliation: "+String(a.ledgerReconciled)+". This wallet snapshot is explicitly unreconciled and must not be treated as a unified cross-asset balance."));
  return;
 }
 if(name==="profile"){
  content.append(grid(card("Demo account ID",a.accountId,"Synthetic identifier"),card("Currency",a.currency,"Account fixture"),card("Mode",model.meta.mode,"No brokerage session"),card("Authentication","Not connected","Production sign-in is not bypassed")));
  content.append(notice("No personal name, email, phone number or editable profile data is present in the shared demo fixture."));
  return;
 }
 if(name==="settings"){
  content.append(grid(card("Data provider",model.meta.provider,"Explicit demo route"),card("Environment",model.meta.mode,"Production mode rejected by adapter"),card("Order execution","Local simulation only","No broker or production RPC"),card("Crypto","Separate","Excluded from Indian-market fixtures")));
  content.append(notice(model.meta.disclaimer));
 }
}
nav.addEventListener("click",event=>{const button=event.target.closest("button[data-screen]");if(!button||!model)return;nav.querySelectorAll("button[data-screen]").forEach(x=>{const active=x===button;x.classList.toggle("active",active);if(active)x.setAttribute("aria-current","page");else x.removeAttribute("aria-current");});render(button.dataset.screen);content.setAttribute("aria-busy","false");});
const translations={
 "Home":"होम","Market":"बाज़ार","Watchlist":"वॉचलिस्ट","Charts / Depth":"चार्ट / डेप्थ","Equity":"इक्विटी","Futures":"फ्यूचर्स","Options":"ऑप्शंस","Orders":"ऑर्डर","Trade History":"ट्रेड इतिहास","Portfolio":"पोर्टफोलियो","Positions":"पोज़िशन","Holdings":"होल्डिंग्स","Wallet":"वर्चुअल वॉलेट","Profile":"प्रोफ़ाइल","Settings":"सेटिंग्स",
 "Home Overview":"होम अवलोकन","Market Snapshot":"बाज़ार स्नैपशॉट","Watchlists":"वॉचलिस्ट","Charts & Depth":"चार्ट और डेप्थ","Equity Paper Trading":"इक्विटी पेपर ट्रेडिंग","Futures Paper Trading":"फ्यूचर्स पेपर ट्रेडिंग","Options Paper Trading":"ऑप्शंस पेपर ट्रेडिंग","Virtual Wallet":"वर्चुअल वॉलेट","Demo Profile":"डेमो प्रोफ़ाइल",
 "Search":"खोजें","Exchange":"एक्सचेंज","Asset class":"एसेट श्रेणी","Underlying":"अंडरलाइंग","Expiry":"एक्सपायरी","Strike":"स्ट्राइक","Option side":"ऑप्शन साइड","All exchanges":"सभी एक्सचेंज","All underlyings":"सभी अंडरलाइंग","All strikes":"सभी स्ट्राइक","Search MOCK symbol or underlying":"मॉक सिंबल या अंडरलाइंग खोजें","Search Futures contract":"फ्यूचर्स कॉन्ट्रैक्ट खोजें","Search option symbol":"ऑप्शन सिंबल खोजें","DEMO INSTRUMENT":"डेमो इंस्ट्रूमेंट","TIMEFRAME":"समयावधि","STYLE":"शैली","CANDLESTICK":"कैंडलस्टिक","LINE":"लाइन","Fixture Bid / Ask Depth":"फ़िक्स्चर बिड / आस्क डेप्थ","BIDS":"बिड","ASKS":"आस्क","QTY":"मात्रा","All instruments":"सभी इंस्ट्रूमेंट","All expiries":"सभी एक्सपायरी","CE + PE":"CE + PE","CE only":"केवल CE","PE only":"केवल PE",
 "Side":"साइड","Order type":"ऑर्डर प्रकार","Product":"प्रोडक्ट","Quantity (shares)":"मात्रा (शेयर)","LIMIT price (₹)":"लिमिट मूल्य (₹)","Pending order to manage":"मैनेज करने के लिए पेंडिंग ऑर्डर","PLACE DEMO ORDER":"डेमो ऑर्डर दें","SIMULATE NEXT FILL":"अगला डेमो फिल","MATCH MARKETABLE DEPTH":"मार्केटेबल डेप्थ मैच करें","CANCEL REMAINDER":"बाकी ऑर्डर रद्द करें",
 "DEMO DATA · SYNTHETIC FIXTURES":"डेमो डेटा · सिंथेटिक फ़िक्स्चर","DEMO · LOCAL DEMO":"डेमो · लोकल डेमो","MOCK · LOCAL DEMO":"मॉक · लोकल डेमो","DEMO DATA · MOCK · SYNTHETIC ONLY":"डेमो डेटा · मॉक · केवल सिंथेटिक","No record exists in the current canonical fixture.":"मौजूदा कैनोनिकल फ़िक्स्चर में कोई रिकॉर्ड नहीं है।","This demo watchlist is empty.":"यह डेमो वॉचलिस्ट खाली है।",
 "Starting capital":"प्रारंभिक पूंजी","Available funds":"उपलब्ध राशि","Blocked funds":"ब्लॉक राशि","Cash balance":"नकद शेष","Realized P&L":"रियलाइज़्ड P&L","Unrealized P&L":"अनरियलाइज़्ड P&L","Records":"रिकॉर्ड","Filled":"भरे गए","Pending":"पेंडिंग","Cancelled":"रद्द",
 "SYMBOL":"सिंबल","EXCHANGE":"एक्सचेंज","TYPE":"प्रकार","MOCK PRICE":"मॉक मूल्य","UP":"ऊपर","DOWN":"नीचे","REMOVE":"हटाएँ","CONTRACT":"कॉन्ट्रैक्ट","LOT SIZE":"लॉट साइज","BID":"बिड","ASK":"आस्क","STRIKE":"स्ट्राइक","INSTRUMENT":"इंस्ट्रूमेंट","QUANTITY":"मात्रा","AVERAGE PRICE":"औसत मूल्य","INVESTED VALUE":"निवेश राशि","STATUS":"स्थिति",
 "Switch interface language to Hindi":"इंटरफ़ेस की भाषा अंग्रेज़ी करें","Switch interface language to English":"इंटरफ़ेस की भाषा हिंदी करें",
 "FUTURES · LOCAL PAPER SIMULATOR":"फ्यूचर्स · लोकल पेपर सिम्युलेटर","OPTIONS · LOCAL PAPER SIMULATOR":"ऑप्शंस · लोकल पेपर सिम्युलेटर","Browser-memory orders and fills use deterministic fixture quotes only. No production RPC, cash ledger, margin reservation, charges, broker API or background worker is called.":"ब्राउज़र मेमोरी के ऑर्डर और फ़िल केवल निर्धारित फ़िक्स्चर कोट का उपयोग करते हैं। कोई प्रोडक्शन RPC, कैश लेजर, मार्जिन रिज़र्वेशन, शुल्क, ब्रोकर API या बैकग्राउंड वर्कर उपयोग नहीं होता।",
 "Futures contract":"फ्यूचर्स कॉन्ट्रैक्ट","Underlying":"अंडरलाइंग","Expiry":"एक्सपायरी","Option type":"ऑप्शन प्रकार","Strike":"स्ट्राइक","Lots":"लॉट","Futures product":"फ्यूचर्स प्रोडक्ट","OPEN DEMO POSITIONS":"ओपन डेमो पोज़िशन","DEMO ORDER RECEIPTS":"डेमो ऑर्डर रसीद","SIMULATE LIMIT MATCH":"लिमिट मैच सिम्युलेट करें","RESET DEMO DEPTH":"डेमो डेप्थ रीसेट करें","CANCEL":"रद्द करें","CONTRACT":"कॉन्ट्रैक्ट","TYPE":"प्रकार","NET QTY":"नेट मात्रा","AVG PRICE":"औसत मूल्य","RESERVED CLOSE":"क्लोज़ के लिए रिज़र्व","AVAILABLE CLOSE":"क्लोज़ के लिए उपलब्ध","ORDER ID":"ऑर्डर ID","LOTS / QTY":"लॉट / मात्रा","LIMIT":"लिमिट","FILLED / REMAINING":"भरे / शेष","AVG FILL":"औसत फ़िल","FILL RECEIPTS":"फ़िल रसीद","ACTION":"कार्रवाई","No open demo positions.":"कोई ओपन डेमो पोज़िशन नहीं।","No demo orders yet.":"अभी कोई डेमो ऑर्डर नहीं।","DEMO receipt":"डेमो रसीद","Select a valid synthetic contract.":"मान्य सिंथेटिक कॉन्ट्रैक्ट चुनें।","Enter a valid LIMIT price in rupees.":"रुपये में मान्य लिमिट मूल्य दर्ज करें।","BUY":"खरीदें","SELL":"बेचें","Intraday":"इंट्राडे","Delivery":"डिलीवरी","MOCK quote selected":"मॉक कोट चुना गया","No matching contract.":"कोई मेल खाता कॉन्ट्रैक्ट नहीं।","Synthetic contracts loaded.":"सिंथेटिक कॉन्ट्रैक्ट लोड हुए।","Demo unavailable":"डेमो उपलब्ध नहीं","LOCAL FUTURES & OPTIONS POSITIONS":"लोकल फ्यूचर्स और ऑप्शंस पोज़िशन","LOCAL FUTURES & OPTIONS FILLS":"लोकल फ्यूचर्स और ऑप्शंस फ़िल","LOCAL FUTURES & OPTIONS ORDERS":"लोकल फ्यूचर्स और ऑप्शंस ऑर्डर","Browser-memory DEMO DATA only. These records are not part of the account fixture, cash ledger or production portfolio.":"केवल ब्राउज़र मेमोरी का डेमो डेटा। ये रिकॉर्ड अकाउंट फ़िक्स्चर, कैश लेजर या प्रोडक्शन पोर्टफोलियो का हिस्सा नहीं हैं।",
 "Simulated Market Explorer":"सिम्युलेटेड मार्केट एक्सप्लोरर","CHARTS & MARKET DATA PLAYGROUND":"चार्ट और मार्केट डेटा प्लेग्राउंड","DEMO INSTRUMENT":"डेमो इंस्ट्रूमेंट","TIMEFRAME":"समयावधि","STYLE":"शैली","CANDLESTICK":"कैंडलस्टिक","LINE":"लाइन","Fixture Bid / Ask Depth":"फ़िक्स्चर बिड / आस्क डेप्थ","BIDS":"बिड","ASKS":"आस्क","Volume bars · synthetic units":"वॉल्यूम बार · सिंथेटिक यूनिट","Canonical fixture levels only":"केवल कैनोनिकल फ़िक्स्चर स्तर","Not executable liquidity":"एक्ज़ीक्यूटेबल लिक्विडिटी नहीं","MOCK · DEMO DATA · NOT LIVE NSE/BSE":"मॉक · डेमो डेटा · लाइव NSE/BSE नहीं"
};
Object.assign(translations,{
 "Private Watchlists":"निजी वॉचलिस्ट","Account-saved lists · private to the signed-in user · separate from Demo Watchlists":"अकाउंट में सेव सूचियाँ · केवल साइन-इन उपयोगकर्ता के लिए निजी · डेमो वॉचलिस्ट से अलग",
 "SAVE TO PRIVATE LIST":"निजी सूची में सेव करें","Private list":"निजी सूची","Add canonical MOCK instrument":"कैनोनिकल MOCK इंस्ट्रूमेंट जोड़ें",
 "Sign in to restore and save private watchlists. Demo Watchlists remain available without sign-in.":"निजी वॉचलिस्ट वापस पाने और सेव करने के लिए साइन इन करें। डेमो वॉचलिस्ट बिना साइन-इन उपलब्ध हैं।",
 "Signed in, but private watchlists are unavailable until the market gateway URL is configured.":"साइन इन है, लेकिन मार्केट गेटवे URL कॉन्फ़िगर होने तक निजी वॉचलिस्ट उपलब्ध नहीं हैं।",
 "Restoring private watchlist…":"निजी वॉचलिस्ट वापस लाई जा रही है…","No saved instruments in this private list.":"इस निजी सूची में कोई इंस्ट्रूमेंट सेव नहीं है।",
 "Private saved watchlist":"सेव की गई निजी वॉचलिस्ट","INSTRUMENT":"इंस्ट्रूमेंट","ORDER":"क्रम","REMOVE":"हटाएँ"
});
const languageToggle=document.getElementById("language-toggle");
let currentLanguage=(()=>{try{return localStorage.getItem("zenura-s-trade-language")==="hi"?"hi":"en";}catch{return "en";}})();
const originalText=new WeakMap();
const originalAttributes=new WeakMap();
const translatableAttributes=["aria-label","placeholder","title"];
function translateTextNode(node){
 if(node.nodeType!==Node.TEXT_NODE||!node.parentElement)return;
 if(!originalText.has(node))originalText.set(node,node.nodeValue);
 else {
  const previous=originalText.get(node).trim(), current=node.nodeValue.trim(), previousHindi=translations[previous];
  if(current!==previous && current!==previousHindi)originalText.set(node,node.nodeValue);
 }
 const source=originalText.get(node).trim();
 if(!source)return;
 const translated=currentLanguage==="hi"?(translations[source]||source):source;
 if(node.nodeValue!==translated)node.nodeValue=translated;
}
function translateAttributes(element){
 const saved=originalAttributes.get(element)||new Map();
 for(const attribute of translatableAttributes){
  if(!element.hasAttribute(attribute))continue;
  const current=element.getAttribute(attribute);
  if(!saved.has(attribute))saved.set(attribute,current);
  else {const original=saved.get(attribute),translated=translations[original];if(current!==original&&current!==translated)saved.set(attribute,current);}
  const original=saved.get(attribute);
  let translated=currentLanguage==="hi"?(translations[original]||original):original;
  if(currentLanguage==="hi"&&/^Move .+ up$/.test(original))translated=original.replace(/^Move (.+) up$/,"$1 को ऊपर ले जाएँ");
  if(currentLanguage==="hi"&&/^Move .+ down$/.test(original))translated=original.replace(/^Move (.+) down$/,"$1 को नीचे ले जाएँ");
  if(current!==translated)element.setAttribute(attribute,translated);
 }
 originalAttributes.set(element,saved);
}
function applyLanguage(){
 document.documentElement.lang=currentLanguage==="hi"?"hi":"en";
 languageToggle.textContent=currentLanguage==="hi"?"English":"हिन्दी";
 languageToggle.setAttribute("aria-pressed",String(currentLanguage==="hi"));
 languageToggle.setAttribute("aria-label",currentLanguage==="hi"?"Switch interface language to English":"Switch interface language to Hindi");
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 while(walker.nextNode())translateTextNode(walker.currentNode);
 document.querySelectorAll("*").forEach(translateAttributes);
}
languageToggle.addEventListener("click",()=>{currentLanguage=currentLanguage==="en"?"hi":"en";try{localStorage.setItem("zenura-s-trade-language",currentLanguage);}catch{}applyLanguage();});
const languageObserver=new MutationObserver(records=>records.forEach(record=>{
 if(record.type==="characterData")translateTextNode(record.target);
 if(record.type==="attributes")translateAttributes(record.target);
 record.addedNodes?.forEach(node=>{
  if(node.nodeType===Node.TEXT_NODE)translateTextNode(node);
  else if(node.nodeType===Node.ELEMENT_NODE){translateAttributes(node);const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);while(walker.nextNode())translateTextNode(walker.currentNode);node.querySelectorAll?.("*").forEach(translateAttributes);}
 });
}));
languageObserver.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:translatableAttributes});
async function loadFixture(name){
 const url=new URL("../../market-gateway/mock/fixtures/"+name+".json",import.meta.url);
 const response=await fetch(url,{method:"GET",credentials:"omit",cache:"no-store",headers:{Accept:"application/json"}});
 if(!response.ok)throw new Error("FIXTURE_LOAD_FAILED:"+name);
 return response.json();
}
async function start(){
 try{
  const [market,account,equity,derivatives]=await Promise.all(["market","account","equity","derivatives"].map(loadFixture));
  model=createPaperDemoViewModel({market,account,equity,derivatives},{enabled:true,production:false});
  status.textContent="4 canonical fixtures validated · DUMMY_JSON · local Equity/F&O simulation only";
  render("home");content.setAttribute("aria-busy","false");applyLanguage();
 }catch(error){
  status.textContent="Demo unavailable: "+(error.message||"fixture validation failed");
  content.replaceChildren(notice("The shared Mock JSON fixture set could not be loaded or validated. No live-data fallback is attempted."));content.setAttribute("aria-busy","false");applyLanguage();
 }
}
start();
