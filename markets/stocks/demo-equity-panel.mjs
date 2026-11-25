import { getSharedPaperDemoLedgerSession } from "../shared/paper-demo-ledger-session.mjs";
import { createEquityDemoLedgerBridge } from "./demo-equity-ledger-bridge.mjs";
let fixturePromise=null,enginePromise=null,engine=null,ledgerBridge=null,orderSequence=0;
const el=(tag,cls,value)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(value!==undefined)node.textContent=String(value);return node;};
const money=paise=>Number.isSafeInteger(paise)?"₹"+(paise/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";
const add=(select,value,label)=>{const option=document.createElement("option");option.value=value;option.textContent=label;select.append(option);};
async function getEngine(){
 if(engine)return engine;
 if(!enginePromise)enginePromise=Promise.all([
  fetch(new URL("../../market-gateway/mock/fixtures/equity-execution.json",import.meta.url),{method:"GET",credentials:"omit",cache:"no-store",headers:{Accept:"application/json"}}),
  fetch(new URL("../../market-gateway/mock/fixtures/account.json",import.meta.url),{method:"GET",credentials:"omit",cache:"no-store",headers:{Accept:"application/json"}})
 ]).then(async([fixtureResponse,accountResponse])=>{
  if(!fixtureResponse.ok||!accountResponse.ok)throw new Error("EQUITY_DEMO_FIXTURE_UNAVAILABLE");
  const [fixtureEnvelope,accountEnvelope]=await Promise.all([fixtureResponse.json(),accountResponse.json()]);
  if(!window.ZenuraEquityDemoEngine?.createEquityDemoExecutionEngine)throw new Error("EQUITY_DEMO_ENGINE_UNAVAILABLE");
  if(accountEnvelope?.mode!=="MOCK"||accountEnvelope?.simulated!==true||accountEnvelope?.meta?.source!=="SYNTHETIC_FIXTURE")throw new Error("INVALID_EQUITY_DEMO_ACCOUNT_FIXTURE");
  engine=window.ZenuraEquityDemoEngine.createEquityDemoExecutionEngine({fixture:fixtureEnvelope,account:accountEnvelope.data,env:{NODE_ENV:(window.ZENURA_RUNTIME_ENV==="development"||window.ZENURA_RUNTIME_ENV==="test")?window.ZENURA_RUNTIME_ENV:"production"}});
  const sharedSession=getSharedPaperDemoLedgerSession({
    accountId:accountEnvelope.data.accountId,
    cashBalancePaise:accountEnvelope.data.cashBalancePaise,
    blockedFundsPaise:accountEnvelope.data.blockedFundsPaise
  });
  ledgerBridge=createEquityDemoLedgerBridge({engine,...sharedSession});
  return engine;
 });
 return enginePromise;
}
function table(host,headers,rows,empty){
 const wrap=el("div","table-wrap demo-eq-table-wrap"),t=el("table"),head=el("thead"),hr=el("tr"),body=el("tbody");
 headers.forEach(x=>hr.append(el("th","",x)));head.append(hr);
 if(!rows.length){const tr=el("tr"),td=el("td","empty",empty);td.colSpan=headers.length;tr.append(td);body.append(tr);}
 else rows.forEach(row=>{const tr=el("tr");row.forEach(value=>tr.append(el("td","",value??"—")));body.append(tr);});
 t.append(head,body);wrap.append(t);host.replaceChildren(wrap);
}
function parsePrice(value){
 const text=String(value||"").trim();if(!/^\d+(?:\.\d{1,2})?$/.test(text))return null;
 const parts=text.split("."),paise=Number(parts[0])*100+Number(((parts[1]||"")+"00").slice(0,2));
 return Number.isSafeInteger(paise)&&paise>0?paise:null;
}
function fillRows(snapshot){return snapshot.fills.map(fill=>[fill.fillId,fill.side,fill.product,fill.quantity,money(fill.pricePaise),money(fill.grossValuePaise),money(fill.realizedPnlPaise),fill.filledAt]);}
function orderRows(snapshot){return snapshot.orders.map(order=>[order.orderId,order.side,order.product,order.orderType,order.quantity,order.filledQuantity+" / "+order.remainingQuantity,order.limitPricePaise?money(order.limitPricePaise):"—",money(order.averagePricePaise),order.status]);}
function positionRows(snapshot,product){
 const account=snapshot.account,key=snapshot.valuation.instrumentKey,rows=[];
 for(const p of ["DELIVERY","INTRADAY"]){
  if(product&&product!==p)continue;
  const item=(p==="DELIVERY"?account.positions:account.intradayPositions)[key];
  if(item)rows.push([snapshot.valuation.instrumentKey,p,item.quantity,item.reservedQuantity||0,money(item.averagePricePaise),money(item.costBasisPaise)]);
 }
 return rows;
}
export async function mountEquityDemo(container){
 const panel=el("section","demo-eq-panel");
 panel.append(el("div","demo-eq-heading","EQUITY · CANONICAL LOCAL PAPER SIMULATOR"));
 panel.append(el("div","demo-eq-identity","DEMO DATA · MOCK · SYNTHETIC ONLY"));
 panel.append(el("p","demo-eq-disclaimer","This reuses the canonical PR #148 Equity engine. Browser-memory only: no production RPC, live price, broker API, tax/fee calculation or database write. This local simulator is separate from the unreconciled Wallet snapshot."));
 const stats=el("div","demo-eq-stats");
 const controls=el("div","demo-eq-controls");
 const side=el("select","demo-eq-input"),type=el("select","demo-eq-input"),product=el("select","demo-eq-input"),quantity=el("input","demo-eq-input"),limit=el("input","demo-eq-input"),activeOrderSelect=el("select","demo-eq-input");
 [["BUY","BUY"],["SELL","SELL"]].forEach(x=>add(side,x[0],x[1]));
 [["MARKET","MARKET"],["LIMIT","LIMIT"]].forEach(x=>add(type,x[0],x[1]));
 [["DELIVERY","Delivery"],["INTRADAY","Intraday"]].forEach(x=>add(product,x[0],x[1]));
 quantity.type="number";quantity.min="1";quantity.max="1000000";quantity.step="1";quantity.value="1";
 limit.type="text";limit.inputMode="decimal";limit.placeholder="e.g. 1,250.50";limit.disabled=true;
 const field=(label,node)=>{const wrap=el("label","demo-eq-field",label);wrap.append(node);return wrap;};
 controls.append(field("Side",side),field("Order type",type),field("Product",product),field("Quantity (shares)",quantity),field("LIMIT price (₹)",limit),field("Pending order to manage",activeOrderSelect));
 panel.append(controls);
 const actions=el("div","demo-eq-actions");
 const submit=el("button","demo-eq-button primary","PLACE DEMO ORDER");
 const match=el("button","demo-eq-button","SIMULATE NEXT FILL");
 const matchAll=el("button","demo-eq-button","MATCH MARKETABLE DEPTH");
 const cancel=el("button","demo-eq-button danger","CANCEL REMAINDER");
 actions.append(submit,match,matchAll,cancel);panel.append(actions);
 const status=el("p","demo-eq-status","Loading validated Equity simulator…");
 const positions=el("div"),orders=el("div"),fills=el("div"),events=el("div");
 panel.append(status,el("h3","demo-eq-subhead","EQUITY POSITIONS"),positions,el("h3","demo-eq-subhead","ORDER RECEIPTS"),orders,el("h3","demo-eq-subhead","IMMUTABLE FILL RECEIPTS"),fills,el("h3","demo-eq-subhead","CANONICAL EVENT LEDGER"),events);
 container.append(panel);
 let activeOrderId="";
 function paint(){
  if(!engine)return;
  const s=engine.snapshot(),a=s.account;
  stats.replaceChildren(
   stat("Cash balance",money(a.cashBalancePaise)),
   stat("Blocked funds",money(a.blockedFundsPaise)),
   stat("Available funds",money(a.availableFundsPaise)),
   stat("Realized P&L",money(a.realizedPnlPaise)),
   stat("Unrealized P&L",money(s.valuation.unrealizedPnlPaise))
  );
  table(positions,["INSTRUMENT","PRODUCT","QTY","RESERVED","AVG PRICE","COST BASIS"],positionRows(s), "No Equity positions yet.");
  table(orders,["ORDER ID","SIDE","PRODUCT","TYPE","QTY","FILLED / REMAINING","LIMIT","AVG FILL","STATUS"],orderRows(s),"No Equity orders yet.");
  table(fills,["FILL ID","SIDE","PRODUCT","QTY","PRICE","GROSS VALUE","REALIZED P&L","EXECUTED AT"],fillRows(s),"No immutable fill receipts yet.");
  const ledgerSnapshot=ledgerBridge?.snapshot();
  table(events,["SEQ","EVENT","SOURCE ID","TIME"],(ledgerSnapshot?.events||[]).map(event=>[event.sequence,event.type,event.sourceEventId,event.occurredAt]),"No canonical events yet.");
  const active=s.orders.filter(x=>["PENDING","PARTIALLY_FILLED"].includes(x.status));
  if(!active.some(x=>x.orderId===activeOrderId))activeOrderId=active.at(-1)?.orderId||"";
  activeOrderSelect.replaceChildren();active.forEach(order=>add(activeOrderSelect,order.orderId,order.orderId+" · "+order.status+" · "+order.remainingQuantity+" remaining"));
  activeOrderSelect.value=activeOrderId;activeOrderSelect.disabled=!active.length;
  match.disabled=!activeOrderId;matchAll.disabled=!activeOrderId;cancel.disabled=!activeOrderId;
 }
 function stat(label,value){const c=el("article","demo-eq-stat");c.append(el("span","",label),el("strong","",value));return c;}
 type.addEventListener("change",()=>{limit.disabled=type.value!=="LIMIT";});
 activeOrderSelect.addEventListener("change",()=>{activeOrderId=activeOrderSelect.value;});
 submit.addEventListener("click",async()=>{
  try{
   const q=Number(quantity.value);if(!Number.isSafeInteger(q)||q<1||q>1000000)throw new Error("Enter a valid whole-share quantity.");
   const request={instrumentKey:engine.snapshot().valuation.instrumentKey,side:side.value,orderType:type.value,product:product.value,quantity:q,idempotencyKey:"equity-demo-"+String(++orderSequence).padStart(8,"0")};
   if(type.value==="LIMIT"){request.limitPricePaise=parsePrice(limit.value);if(!request.limitPricePaise)throw new Error("Enter a valid LIMIT price in rupees.");}
   const order=ledgerBridge.submitOrder(request).order;activeOrderId=order.orderId;status.textContent="Order accepted · "+order.orderId+" · canonical ledger events: "+ledgerBridge.snapshot().events.length+". Use a manual fill action to simulate execution (MOCK only).";paint();
  }catch(error){status.textContent=error.message||"Demo order rejected.";}
 });
 match.addEventListener("click",()=>{
  try{const result=ledgerBridge.matchNext(activeOrderId,{executionId:"equity-fill-"+String(engine.snapshot().fills.length+1).padStart(8,"0")});status.textContent=result.matched?"Synthetic fill "+result.fill.fillId+" · "+result.fill.quantity+" shares @ "+money(result.fill.pricePaise)+" · ledger updated.":"No fill · "+result.reason;paint();}
  catch(error){status.textContent=error.message||"Demo fill failed.";}
 });
 matchAll.addEventListener("click",()=>{
  try{let count=0,result;do{result=ledgerBridge.matchNext(activeOrderId,{executionId:"equity-fill-"+String(engine.snapshot().fills.length+1).padStart(8,"0")});if(result.matched)count++;}while(result.matched&&engine.getOrder(activeOrderId)?.remainingQuantity>0);
   status.textContent="Manual synthetic depth matching complete · "+count+" fill(s) · "+(result.reason||result.order.status)+". No worker ran.";paint();}
  catch(error){status.textContent=error.message||"Demo matching failed.";}
 });
 cancel.addEventListener("click",()=>{
  try{const result=ledgerBridge.cancelOrder(activeOrderId);status.textContent=result.cancelled?"Unfilled remainder cancelled · released cash "+money(result.releasedCashPaise)+" · released shares "+result.releasedShareQuantity+". Canonical ledger updated.":"Order not cancelled · "+(result.reason||"not open");paint();}
  catch(error){status.textContent=error.message||"Demo cancellation failed.";}
 });
 getEngine().then(()=>{status.textContent="Canonical Equity simulator ready · MOCKALPHA · synthetic book only.";paint();}).catch(error=>{status.textContent="Equity Demo unavailable · "+(error.message||"fixture validation failed")+". No live fallback.";submit.disabled=match.disabled=matchAll.disabled=cancel.disabled=true;});
}
export async function appendEquitySummary(container,screen){
 const section=el("section","demo-eq-summary");
 section.append(el("h3","demo-eq-subhead",screen==="trades"?"LOCAL EQUITY FILL RECEIPTS":screen==="holdings"?"LOCAL DELIVERY HOLDINGS":screen==="positions"?"LOCAL EQUITY POSITIONS":"LOCAL EQUITY DEMO ORDERS"));
 section.append(el("p","demo-eq-disclaimer","Browser-memory DEMO DATA only. This isolated Equity simulator is not reconciled with the Wallet or cross-asset ledger."));
 const host=el("div");section.append(host);container.append(section);
 try{
  const e=await getEngine(),s=e.snapshot();
  if(screen==="trades")table(host,["FILL ID","SIDE","PRODUCT","QTY","PRICE","GROSS VALUE","REALIZED P&L","EXECUTED AT"],fillRows(s),"No Equity fill receipts.");
  else if(screen==="positions"||screen==="portfolio")table(host,["INSTRUMENT","PRODUCT","QTY","RESERVED","AVG PRICE","COST BASIS"],positionRows(s),"No Equity positions.");
  else if(screen==="holdings")table(host,["INSTRUMENT","DELIVERY QTY","AVG PRICE","COST BASIS"],positionRows(s,"DELIVERY").map(row=>[row[0],row[2],row[4],row[5]]),"No Delivery holdings.");
  else table(host,["ORDER ID","SIDE","PRODUCT","TYPE","QTY","FILLED / REMAINING","LIMIT","AVG FILL","STATUS"],orderRows(s),"No Equity orders.");
 }catch(error){host.append(el("p","demo-eq-status","Local Equity Demo records unavailable · "+(error.message||"fixture error")));}
}
