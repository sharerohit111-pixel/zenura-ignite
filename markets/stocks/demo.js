(function(){
"use strict";
const status=document.getElementById("demo-status");
const content=document.getElementById("screen-content");
const nav=document.getElementById("screen-nav");
let client=null,fixtures={};
const titles={home:"Home Overview",market:"Market Snapshot",watchlists:"Watchlists",charts:"Charts & Depth",equity:"Equity Paper Trading",futures:"Futures Paper Trading",options:"Options Paper Trading",orders:"Orders",trades:"Trade History",portfolio:"Portfolio",positions:"Positions",holdings:"Holdings",account:"Virtual Wallet",profile:"Profile",settings:"Settings"};
function el(tag,cls,txt){const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=String(txt);return n}
function money(paise){return "₹"+(Number(paise||0)/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}
function card(label,value,detail){const c=el("article","card");c.append(el("h3","",label),el("div","metric",value),el("div","sub","",detail));return c}
function sectionTitle(name,description){const row=el("div","screen-title");const left=el("div");left.append(el("h2","",titles[name]||name),el("p","",description));row.append(left,el("span","read-only","READ ONLY · MOCK"));return row}
function table(headers,rows){const wrap=el("div","table-wrap"),t=el("table"),head=el("thead"),hr=el("tr");headers.forEach(h=>hr.append(el("th","",h)));head.append(hr);const body=el("tbody");rows.forEach(row=>{const tr=el("tr");row.forEach(v=>tr.append(el("td","",v)));body.append(tr)});t.append(head,body);wrap.append(t);return wrap}
function grid(...items){const g=el("div","grid");items.forEach(x=>g.append(x));return g}
function fixture(name){return fixtures[name]?.data||{}}
function render(name){
 const market=fixture("market"),account=fixture("account"),equity=fixture("equity"),deriv=fixture("derivatives");
 content.replaceChildren(sectionTitle(name,"All values are deterministic synthetic examples. They are not exchange prices or executable orders."));
 if(name==="home"||name==="market"||name==="watchlists"||name==="charts"){
  const quotes=market.quotes||[];
  content.append(grid(card("Market status",market.marketStatus||"—","Synthetic session fixture"),card("Instruments",String(quotes.length),"Sample quotes only"),card("Exchange",market.exchange||"—","NSE/BSE sample"),card("Data timestamp",fixtures.market.asOf||"—","Fixture snapshot, not live")));
  content.append(table(["SYMBOL","INSTRUMENT KEY","SAMPLE PRICE","CHANGE","VOLUME","SOURCE"],quotes.map(q=>[q.symbol,q.instrumentKey,money(q.lastPricePaise),(q.changePaise>=0?"+":"")+money(q.changePaise),q.volume,q.provider])));
  if(name==="charts"){const depth=market.depth||{};content.append(el("h3","","Synthetic bid / ask depth"),table(["SIDE","PRICE","QUANTITY"],[...(depth.bids||[]).map(x=>["BID",money(x.pricePaise),x.quantity]),...(depth.asks||[]).map(x=>["ASK",money(x.pricePaise),x.quantity])]));}
  return;
 }
 if(name==="account"||name==="profile"||name==="settings"){
  content.append(grid(card("Virtual starting capital",money(account.startingCapitalPaise),"₹10,00,000 demo account"),card("Cash balance",money(account.cashBalancePaise),"Fixture snapshot"),card("Blocked funds",money(account.blockedFundsPaise),"No real funds"),card("Available funds",money(account.availableFundsPaise),"Not reconciled across asset ledgers")));
  content.append(el("div","notice","Ledger reconciliation: "+String(account.ledgerReconciled)+" · This wallet fixture is illustrative only and must not be treated as a unified reconciled balance."));
  return;
 }
 if(name==="futures"||name==="options"){
  const x=name==="futures"?deriv.futures:deriv.options;
  content.append(grid(card("Contract",x.symbol||x.underlying||"—","Synthetic non-tradable contract"),card("Expiry",x.expiry||"—","Fixture date"),card(name==="futures"?"Lot size":"Option type",name==="futures"?x.lotSize:x.optionType,"Sample contract metadata"),card("Order state",x.order?.status||"—","No order is submitted")));
  content.append(table(["ORDER ID","SIDE","TYPE","LOTS","LIMIT / AVG PRICE","STATUS"],[[x.order?.orderId||"—",x.order?.side||"—",x.order?.orderType||"—",x.order?.lots||"—",money(x.order?.limitPricePaise||x.order?.averagePricePaise||0),x.order?.status||"—"]]));
  content.append(el("div","notice","Futures/Options preview only. No margin reservation, fill worker, or exchange/broker order is invoked from this demo page."));
  return;
 }
 if(name==="equity"||name==="orders"||name==="trades"||name==="portfolio"||name==="positions"||name==="holdings"){
  const order=equity.order||{},position=equity.position||{};
  content.append(grid(card("Product",equity.product||"—","Sample Equity product"),card("Order status",order.status||"—","Fixture record only"),card("Position quantity",position.quantity??"—","Synthetic position"),card("Invested value",money(position.investedValuePaise),"Sample value")));
  content.append(table(["ORDER ID","SIDE","TYPE","QUANTITY","AVERAGE PRICE","CHARGES","STATUS"],[[order.orderId||"—",order.side||"—",order.orderType||"—",order.quantity||"—",money(order.averagePricePaise),money(order.chargesPaise),order.status||"—"]]));
  content.append(table(["SYMBOL","NET QUANTITY","AVERAGE PRICE","INVESTED VALUE","REALIZED P&L","UNREALIZED P&L"],[[equity.symbol||"—",position.quantity??"—",money(position.averagePricePaise),money(position.investedValuePaise),money(position.realizedPnlPaise),money(position.unrealizedPnlPaise)]]));
  content.append(el("div","notice","These are read-only sample records. New orders, cancellation, fills, ledger writes and portfolio mutations are disabled."));
  return;
 }
 content.append(el("div","empty","No additional profile-specific fields are included in the current shared fixture set. The shared account fixture is shown above."));
}
nav.addEventListener("click",event=>{const b=event.target.closest("button[data-screen]");if(!b)return;nav.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));render(b.dataset.screen)});
async function start(){
 try{
  client=window.ZenuraPaperDemoAdapter.createDemoClient({allowDemo:true});
  const names=["market","account","equity","derivatives","error"];
  const values=await Promise.all(names.map(n=>client.readFixture(n)));
  names.forEach((n,i)=>fixtures[n]=values[i]);
  status.textContent="Fixtures validated · 5 shared JSON files · orders disabled";
  render("home");
 }catch(error){status.textContent="Demo unavailable: "+(error.message||"fixture load failed");content.replaceChildren(el("div","empty","Could not load the shared synthetic fixture set. Check the fixture path and try again."));}
}
start();
})();
