import { createPaperDemoViewModel, searchPaperDemoInstruments, getPaperDemoExpiries, getPaperDemoOptionChain } from "../shared/paper-demo-adapter.mjs";
import { mountPrivateWatchlists } from "./demo-watchlist-persistence.mjs";
import { mountDerivativeDemo } from "./demo-derivative-panel.mjs";
import { mountDemoChart } from "./demo-chart-panel.mjs";
import { mountEquityDemo } from "./demo-equity-panel.mjs";
import { appendUnifiedLedgerSummary } from "./demo-unified-ledger-panel.mjs";

"use strict";
const status=document.getElementById("demo-status");
const content=document.getElementById("screen-content");
const nav=document.getElementById("screen-nav");
const screens=["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"];
const titles={home:"Home Overview",market:"Market Snapshot",watchlists:"Watchlists",charts:"Charts & Depth",equity:"Equity Paper Trading",futures:"Futures Paper Trading",options:"Options Paper Trading",orders:"Orders",trades:"Trade History",portfolio:"Portfolio",positions:"Positions",holdings:"Holdings",account:"Virtual Wallet",profile:"Demo Profile",settings:"Settings"};
let model=null;
let watchlistCleanup=null;
let renderGeneration=0;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
const money=paise=>"₹"+(Number(paise||0)/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const card=(label,value,detail)=>{const c=el("article","card");c.append(el("h3","",label),el("div","metric",value),el("div","sub",detail||""));return c;};
const grid=(...items)=>{const g=el("div","grid");items.forEach(x=>g.append(x));return g;};
const table=(headers,rows)=>{const wrap=el("div","table-wrap"),t=el("table"),head=el("thead"),hr=el("tr"),body=el("tbody");wrap.tabIndex=0;wrap.setAttribute("role","region");wrap.setAttribute("aria-label","Scrollable data table");headers.forEach(h=>hr.append(el("th","",h)));head.append(hr);rows.forEach(row=>{const tr=el("tr");row.forEach(v=>tr.append(el("td","",v??"—")));body.append(tr);});if(!rows.length){const tr=el("tr"),td=el("td","empty","No record exists in the current canonical fixture.");td.colSpan=headers.length;tr.append(td);body.append(tr);}t.append(head,body);wrap.append(t);return wrap;};
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
 const statuses=["NSE","BSE"].map(exchange=>{const supplied=model.market.exchange===exchange?model.market.marketStatus:"NOT SUPPLIED";return card(exchange+" MOCK status",supplied,"Synthetic fixture status · not official");});
 host.append(grid(...statuses));
 host.append(el("h3","","Synthetic index snapshot"),table(["INDEX","EXCHANGE","SAMPLE LEVEL","CHANGE"],indices.map(x=>[x.symbol,x.exchange,money(x.lastPricePaise),(instrumentChangePercent(x).toFixed(2))+"%"])));
 const gainers=equities.slice().sort((a,b)=>instrumentChangePercent(b)-instrumentChangePercent(a)).slice(0,3);
 const losers=equities.slice().sort((a,b)=>instrumentChangePercent(a)-instrumentChangePercent(b)).slice(0,3);
 host.append(grid(card("Top synthetic gainers",gainers.map(x=>x.symbol+" "+instrumentChangePercent(x).toFixed(2)+"%").join(" · ")||"—","MOCK fixture only"),card("Top synthetic losers",losers.map(x=>x.symbol+" "+instrumentChangePercent(x).toFixed(2)+"%").join(" · ")||"—","MOCK fixture only")));
 const catalog=el("section","catalog-panel");host.append(catalog);renderInstrumentCatalog(catalog);
 host.append(notice("All indices, prices, movers and exchange statuses are synthetic MOCK values. They are not live NSE/BSE data or official exchange status."));
}
function orderRows(orders){return orders.map(o=>{const instrument=model.market.instruments.find(item=>item.instrumentKey===o.instrumentKey);return [o.orderId,o.assetClass,instrument?.symbol||o.instrumentKey,o.side,o.orderType,o.quantity??o.lots,o.status,money(o.averagePricePaise??o.limitPricePaise??0),money(o.chargesPaise??0)];});}
function render(name){
 const generation=++renderGeneration;
 if(watchlistCleanup){watchlistCleanup();watchlistCleanup=null;}
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
  mountPrivateWatchlists(content, { model, el, field, selectControl, money }).then(cleanup=>{
   if(generation===renderGeneration)watchlistCleanup=cleanup;
   else cleanup?.();
  }).catch(error=>content.append(notice("Private watchlist unavailable: "+(error?.message||"Please retry."))));
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
 if(name==="orders"||name==="trades"||name==="portfolio"||name==="positions"||name==="holdings"){
  appendUnifiedLedgerSummary(content,name);
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
nav.addEventListener("click",event=>{const button=event.target.closest("button[data-screen]");if(!button||!model)return;nav.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===button));render(button.dataset.screen);});
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
  render("home");
 }catch(error){
  status.textContent="Demo unavailable: "+(error.message||"fixture validation failed");
  content.replaceChildren(notice("The shared Mock JSON fixture set could not be loaded or validated. No live-data fallback is attempted."));
 }
}
start();
