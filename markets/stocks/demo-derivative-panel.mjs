let fixturePromise=null,simulator=null;
const el=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value);return n;};
const money=value=>Number.isSafeInteger(value)?"₹"+(value/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";
const add=(select,value,label)=>{const o=document.createElement("option");o.value=value;o.textContent=label;select.append(o);};
async function getSimulator(){
 if(simulator)return simulator;
 if(!fixturePromise)fixturePromise=fetch(new URL("../../market-gateway/mock/fixtures/derivatives.json",import.meta.url),{method:"GET",credentials:"omit",cache:"no-store",headers:{Accept:"application/json"}}).then(r=>{if(!r.ok)throw new Error("DEMO_DERIVATIVES_FIXTURE_UNAVAILABLE");return r.json();});
 const fixture=await fixturePromise;
 if(!window.ZENURA_DERIVATIVE_MOCK?.createDerivativeMockSimulator)throw new Error("DEMO_DERIVATIVE_SIMULATOR_UNAVAILABLE");
 simulator=window.ZENURA_DERIVATIVE_MOCK.createDerivativeMockSimulator(fixture);return simulator;
}
function renderTable(host,headers,rows,empty){
 const wrap=el("div","table-wrap demo-fo-table-wrap"),t=el("table"),h=el("thead"),hr=el("tr"),b=el("tbody");
 wrap.tabIndex=0;wrap.setAttribute("role","region");wrap.setAttribute("aria-label","Futures and Options demo table");
 headers.forEach(x=>{const th=el("th","",x);th.scope="col";hr.append(th);});h.append(hr);
 if(!rows.length){const tr=el("tr"),td=el("td","empty",empty);td.colSpan=headers.length;tr.append(td);b.append(tr);}
 else rows.forEach(row=>{const tr=el("tr");row.forEach(x=>tr.append(el("td","",x==null?"—":x)));b.append(tr);});
 t.append(h,b);wrap.append(t);host.replaceChildren(wrap);
}
export async function mountDerivativeDemo(container,screen){
 const panel=el("section","demo-fo-panel");
 panel.append(el("div","demo-fo-heading",screen==="futures"?"FUTURES · LOCAL PAPER SIMULATOR":"OPTIONS · LOCAL PAPER SIMULATOR"));
 panel.append(el("div","demo-fo-identity","DEMO DATA · MOCK · SYNTHETIC ONLY"));
 panel.append(el("p","demo-fo-disclaimer","Browser-memory orders and fills use deterministic fixture quotes only. No production RPC, cash ledger, margin reservation, charges, broker API or background worker is called."));
 const controls=el("div","demo-fo-controls");
 const contract=el("select","demo-fo-input"),expiry=el("select","demo-fo-input"),optionType=el("select","demo-fo-input"),strike=el("select","demo-fo-input");
 const side=el("select","demo-fo-input"),orderType=el("select","demo-fo-input"),lots=el("input","demo-fo-input"),product=el("select","demo-fo-input"),limit=el("input","demo-fo-input");
 const field=(label,node)=>{const l=el("label","demo-fo-field",label);l.append(node);return l;};
 [["BUY","BUY"],["SELL","SELL"]].forEach(x=>add(side,x[0],x[1]));
 [["MARKET","MARKET"],["LIMIT","LIMIT"]].forEach(x=>add(orderType,x[0],x[1]));
 [["INTRADAY","Intraday"],["DELIVERY","Delivery"]].forEach(x=>add(product,x[0],x[1]));
 [["CE","CE"],["PE","PE"]].forEach(x=>add(optionType,x[0],x[1]));
 lots.type="number";lots.min="1";lots.max="10000";lots.step="1";lots.value="1";
 limit.type="text";limit.inputMode="decimal";limit.placeholder="e.g. 25000.50";limit.disabled=true;
 controls.append(field(screen==="futures"?"Futures contract":"Underlying",contract));
 if(screen==="options")controls.append(field("Expiry",expiry),field("Option type",optionType),field("Strike",strike));
 controls.append(field("Side",side),field("Order type",orderType),field("Lots",lots));
 if(screen==="futures")controls.append(field("Futures product",product));
 controls.append(field("LIMIT price (₹)",limit));panel.append(controls);
 const actions=el("div","demo-fo-actions"),buy=el("button","demo-fo-button","BUY"),sell=el("button","demo-fo-button","SELL");
 const match=el("button","demo-fo-button secondary","SIMULATE LIMIT MATCH"),refresh=el("button","demo-fo-button secondary","RESET DEMO DEPTH");
 actions.append(buy,sell,match,refresh);panel.append(actions);
 const status=el("p","demo-fo-status","Loading deterministic derivatives fixture…"),positions=el("div"),orders=el("div");
 panel.append(status,el("h3","demo-fo-subhead","OPEN DEMO POSITIONS"),positions,el("h3","demo-fo-subhead","DEMO ORDER RECEIPTS"),orders);container.append(panel);
 let engine,contracts=[];
 const selected=()=>screen==="futures"?contracts.find(x=>x.instrumentKey===contract.value):contracts.find(x=>x.underlying===contract.value&&x.expiry===expiry.value&&x.optionType===optionType.value&&x.strikePaise===Number(strike.value));
 function filters(){
  const oldExpiry=expiry.value,oldStrike=strike.value,opts=contracts.filter(x=>x.underlying===contract.value);
  expiry.replaceChildren();[...new Set(opts.map(x=>x.expiry))].sort().forEach(x=>add(expiry,x,x));if([...expiry.options].some(x=>x.value===oldExpiry))expiry.value=oldExpiry;
  strike.replaceChildren();opts.filter(x=>x.expiry===expiry.value&&x.optionType===optionType.value).map(x=>x.strikePaise).filter((x,i,a)=>a.indexOf(x)===i).sort((a,b)=>a-b).forEach(x=>add(strike,String(x),money(x)));if([...strike.options].some(x=>x.value===oldStrike))strike.value=oldStrike;
 }
 function paint(){
  const s=engine.snapshot();
  renderTable(positions,["CONTRACT","TYPE","EXPIRY","NET QTY","AVG PRICE","RESERVED CLOSE","AVAILABLE CLOSE"],s.positions.map(x=>[x.symbol,x.assetClass==="OPTION"?x.optionType:"FUT",x.expiry,x.netQuantity,money(x.averagePricePaise),x.reservedCloseQuantity,x.availableCloseQuantity]),"No open demo positions.");
  const wrap=el("div","table-wrap demo-fo-table-wrap"),t=el("table"),head=el("thead"),hr=el("tr"),body=el("tbody");
  ["ORDER ID","CONTRACT","SIDE","TYPE","LOTS / QTY","LIMIT","FILLED / REMAINING","AVG FILL","FILL RECEIPTS","STATUS","ACTION"].forEach(x=>hr.append(el("th","",x)));
  head.append(hr);
  if(!s.orders.length){const tr=el("tr"),td=el("td","empty","No demo orders yet.");td.colSpan=11;tr.append(td);body.append(tr);}
  s.orders.forEach(order=>{
   const tr=el("tr");
   [order.orderId,order.symbol,order.side,order.orderType,order.lots+" ("+order.quantity+")",order.limitPricePaise?money(order.limitPricePaise):"—",order.filledQuantity+" / "+order.remainingQuantity,order.averageFillPricePaise?money(order.averageFillPricePaise):"—",order.fills.map(f=>f.quantity+" @ "+money(f.pricePaise)).join(" · ")||"—",order.status].forEach(x=>tr.append(el("td","",x)));
   const action=el("td");
   if(["PENDING","PARTIALLY_FILLED"].includes(order.status)){
    const cancel=el("button","demo-fo-button secondary","CANCEL");
    cancel.addEventListener("click",()=>{try{engine.cancel(order.orderId);status.textContent="DEMO order "+order.orderId+" cancelled; unfilled remainder released.";paint();}catch(error){status.textContent=error.message||"Cancellation failed.";}});action.append(cancel);
   }else action.textContent="—";
   tr.append(action);body.append(tr);
  });
  t.append(head,body);wrap.append(t);orders.replaceChildren(wrap);
 }
 function parsePrice(v){if(!/^\d+(?:\.\d{1,2})?$/.test(String(v||"").trim()))return null;const p=String(v).split(".");const n=Number(p[0])*100+Number(((p[1]||"")+"00").slice(0,2));return Number.isSafeInteger(n)&&n>0?n:null;}
 function submit(which){try{const c=selected();if(!c)throw new Error("Select a valid synthetic contract.");const request={instrumentKey:c.instrumentKey,side:which,orderType:orderType.value,lots:Number(lots.value)};if(screen==="futures")request.product=product.value;if(orderType.value==="LIMIT"){request.limitPricePaise=parsePrice(limit.value);if(!request.limitPricePaise)throw new Error("Enter a valid LIMIT price in rupees.");}const receipt=engine.submit(request);status.textContent="DEMO receipt "+receipt.orderId+" · "+receipt.status+" · "+receipt.filledQuantity+"/"+receipt.quantity+" units filled.";paint();}catch(e){status.textContent=e.message||"Demo order rejected.";}}
 try{
  engine=await getSimulator();contracts=engine.contracts().filter(x=>x.assetClass===(screen==="futures"?"FUTURE":"OPTION"));
  contract.replaceChildren();
  if(screen==="futures")contracts.forEach(x=>add(contract,x.instrumentKey,x.symbol+" · "+x.expiry+" · lot "+x.lotSize));
  else{[...new Set(contracts.map(x=>x.underlying))].forEach(x=>add(contract,x,x));filters();}
  [contract,expiry,optionType,strike].forEach(x=>x.addEventListener("change",()=>{if(screen==="options")filters();const c=selected();status.textContent=c?"MOCK quote selected · "+c.symbol+" · "+c.expiry:"No matching contract.";paint();}));
  orderType.addEventListener("change",()=>{limit.disabled=orderType.value!=="LIMIT";});
  buy.addEventListener("click",()=>submit("BUY"));sell.addEventListener("click",()=>submit("SELL"));
  match.addEventListener("click",()=>{const r=engine.processLimitFills();status.textContent="Manual DEMO match · "+r.filled+" filled · "+r.partial+" partial · "+r.notEligible+" not eligible. No worker ran.";paint();});
  refresh.addEventListener("click",()=>{const r=engine.refreshQuoteDepth();status.textContent="DEMO fixture depth reset · "+r.refreshed+" quotes.";paint();});
  const c=selected();status.textContent=c?"MOCK quote selected · "+c.symbol+" · "+c.expiry:"Synthetic contracts loaded.";paint();
 }catch(e){status.textContent="Demo unavailable · "+(e.message||"fixture validation failed")+". No live fallback.";buy.disabled=true;sell.disabled=true;match.disabled=true;refresh.disabled=true;}
}

export async function appendDerivativeSummary(container, screen) {
  const section = el("section", "demo-fo-summary");
  section.append(el("h3", "demo-fo-subhead",
    screen === "positions" || screen === "portfolio" ? "LOCAL FUTURES & OPTIONS POSITIONS" :
    screen === "trades" ? "LOCAL FUTURES & OPTIONS FILLS" : "LOCAL FUTURES & OPTIONS ORDERS"));
  section.append(el("p", "demo-fo-disclaimer",
    "Browser-memory DEMO DATA only. These records are not part of the account fixture, cash ledger or production portfolio."));
  const host = el("div");
  section.append(host);
  container.append(section);
  try {
    const engine = await getSimulator();
    const snapshot = engine.snapshot();
    if (screen === "positions" || screen === "portfolio") {
      renderTable(host,
        ["CONTRACT","ASSET","EXPIRY","NET QTY","AVG PRICE","RESERVED CLOSE","AVAILABLE CLOSE"],
        snapshot.positions.map(x => [x.symbol,x.assetClass === "OPTION" ? x.optionType : "FUT",x.expiry,x.netQuantity,money(x.averagePricePaise),x.reservedCloseQuantity,x.availableCloseQuantity]),
        "No local Futures/Options demo positions.");
    } else if (screen === "trades") {
      const rows = snapshot.orders.flatMap(order => order.fills.map(fill => [
        fill.fillId,order.symbol,order.side,order.orderType,fill.quantity,money(fill.pricePaise),money(fill.grossPaise),fill.executedAt
      ]));
      renderTable(host,["FILL ID","CONTRACT","SIDE","ORDER TYPE","QTY","FILL PRICE","GROSS VALUE","EXECUTED AT"],rows,"No local Futures/Options demo fills.");
    } else {
      renderTable(host,
        ["ORDER ID","CONTRACT","SIDE","TYPE","QTY","FILLED / REMAINING","AVG FILL","STATUS"],
        snapshot.orders.map(x => [x.orderId,x.symbol,x.side,x.orderType,x.quantity,x.filledQuantity+" / "+x.remainingQuantity,x.averageFillPricePaise?money(x.averageFillPricePaise):"—",x.status]),
        "No local Futures/Options demo orders.");
    }
  } catch (error) {
    host.append(el("p","demo-fo-status","Local derivative Demo records unavailable · "+(error.message || "fixture error")));
  }
}
