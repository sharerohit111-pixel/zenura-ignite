import { createPaperDemoViewModel } from "../shared/paper-demo-adapter.mjs";
import { mountDerivativeDemo, appendDerivativeSummary } from "./demo-derivative-panel.mjs";
import { mountEquityDemo, appendEquitySummary } from "./demo-equity-panel.mjs";

"use strict";
const status=document.getElementById("demo-status");
const content=document.getElementById("screen-content");
const nav=document.getElementById("screen-nav");
const screens=["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"];
const titles={home:"Home Overview",market:"Market Snapshot",watchlists:"Watchlists",charts:"Charts & Depth",equity:"Equity Paper Trading",futures:"Futures Paper Trading",options:"Options Paper Trading",orders:"Orders",trades:"Trade History",portfolio:"Portfolio",positions:"Positions",holdings:"Holdings",account:"Virtual Wallet",profile:"Demo Profile",settings:"Settings"};
let model=null;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
const money=paise=>"₹"+(Number(paise||0)/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const card=(label,value,detail)=>{const c=el("article","card");c.append(el("h3","",label),el("div","metric",value),el("div","sub",detail||""));return c;};
const grid=(...items)=>{const g=el("div","grid");items.forEach(x=>g.append(x));return g;};
const table=(headers,rows)=>{const wrap=el("div","table-wrap"),t=el("table"),head=el("thead"),hr=el("tr"),body=el("tbody");headers.forEach(h=>hr.append(el("th","",h)));head.append(hr);rows.forEach(row=>{const tr=el("tr");row.forEach(v=>tr.append(el("td","",v??"—")));body.append(tr);});if(!rows.length){const tr=el("tr"),td=el("td","empty","No record exists in the current canonical fixture.");td.colSpan=headers.length;tr.append(td);body.append(tr);}t.append(head,body);wrap.append(t);return wrap;};
const notice=text=>el("div","notice",text);
function header(name,description){const row=el("div","screen-title"),left=el("div");left.append(el("h2","",titles[name]||name),el("p","",description));row.append(left,el("span","read-only","READ ONLY · MOCK"));return row;}
function quoteRows(){return model.market.instruments.map(x=>[x.symbol,x.exchange,x.assetClass,money(x.lastPricePaise),(x.changePaise>=0?"+":"")+money(x.changePaise),x.volume,x.timestamp]);}
function orderRows(orders){return orders.map(o=>[o.orderId,o.assetClass,o.instrumentKey,o.side,o.orderType,o.quantity??o.lots,o.status,money(o.averagePricePaise??o.limitPricePaise??0),money(o.chargesPaise??0)]);}
function render(name){
 const a=model.account,equity=model.positions.find(x=>x.assetClass==="EQUITY"),orders=model.orders;
 content.replaceChildren(header(name,"Illustrative values from one validated, versioned Mock JSON view model. Not live exchange data."));
 if(name==="home"){
  content.append(grid(card("Virtual starting capital",money(a.startingCapitalPaise),"₹10,00,000 synthetic account"),card("Available funds",money(a.availableFundsPaise),"Fixture snapshot"),card("Instruments",String(model.market.instruments.length),"NSE/BSE MOCK symbols"),card("Sample orders",String(orders.length),"Read-only records")));
  content.append(el("h3","","Synthetic market snapshot"),table(["SYMBOL","EXCHANGE","ASSET","SAMPLE PRICE","CHANGE","VOLUME","AS OF"],quoteRows()));
  return;
 }
 if(name==="market"||name==="watchlists"){
  content.append(grid(card("Exchange",model.market.exchange||"NSE / BSE","Fixture metadata"),card("Market status",model.market.marketStatus||"—","Simulated status only"),card("Instrument count",String(model.market.instruments.length),"MOCK-only identities"),card("As of",model.asOf,"Fixed fixture timestamp")));
  content.append(table(["SYMBOL","EXCHANGE","ASSET","SAMPLE PRICE","CHANGE","VOLUME","AS OF"],quoteRows()));
  content.append(notice(name==="watchlists"?"The shared fixture contains sample instruments only. No private watchlist is read or modified in this isolated preview.":"Search and filtering against the authoritative instrument master are not simulated by this compact shared fixture."));
  return;
 }
 if(name==="charts"){
  const d=model.market.depth;
  content.append(grid(card("Depth instrument",d.instrumentKey,"Synthetic depth fixture"),card("Bid levels",String(d.bids.length),"Illustrative only"),card("Ask levels",String(d.asks.length),"Illustrative only"),card("OHLC candles","Not supplied","No fabricated chart history")));
  content.append(table(["SIDE","PRICE","QUANTITY"],[...d.bids.map(x=>["BID",money(x.pricePaise),x.quantity]),...d.asks.map(x=>["ASK",money(x.pricePaise),x.quantity])]));
  content.append(notice("Depth is synthetic. OHLC candles are absent from this canonical fixture set and are intentionally not invented."));
  return;
 }
 if(name==="equity"){
  mountEquityDemo(content);
  return;
 }
 if(name==="futures"||name==="options"){
  const x=name==="futures"?model.derivatives.futures:model.derivatives.options;
  const order=orders.find(o=>o.assetClass===(name==="futures"?"FUTURE":"OPTION"));
  content.append(grid(card("Contract",x.symbol||x.underlying,"MOCK contract only"),card("Expiry",x.expiry,"Illustrative contract date"),card(name==="futures"?"Lot size":"Option type",name==="futures"?x.lotSize:x.optionType,"Fixture metadata"),card("Strike",name==="options"?money(x.strikePaise):"Not applicable",name==="options"?"Paise-based strike":"Futures contract")));
  content.append(table(["ORDER ID","INSTRUMENT","SIDE","TYPE","SIZE","STATUS","AVG / LIMIT"],orderRows(order?[order]:[])));
  content.append(notice("Canonical MOCK contracts power the local Futures/Options simulator below. Production execution and workers remain separate."));
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
  content.append(grid(card("Data provider",model.meta.provider,"Explicit demo route"),card("Environment",model.meta.mode,"Production mode rejected by adapter"),card("Order submission","Disabled","Read-only preview"),card("Crypto","Separate","Excluded from Indian-market fixtures")));
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
  status.textContent="4 canonical fixtures validated · DUMMY_JSON · order actions disabled";
  render("home");
 }catch(error){
  status.textContent="Demo unavailable: "+(error.message||"fixture validation failed");
  content.replaceChildren(notice("The shared Mock JSON fixture set could not be loaded or validated. No live-data fallback is attempted."));
 }
}
start();
