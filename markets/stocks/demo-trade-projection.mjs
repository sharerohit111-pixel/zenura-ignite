"use strict";
let projection=null;
function cleanKey(source,value){
 const input=String(source)+"|"+String(value);
 let a=2166136261,b=0x9e3779b9;
 for(let i=0;i<input.length;i++){const c=input.charCodeAt(i);a=Math.imul(a^c,16777619)>>>0;b=Math.imul(b^c,2246822519)>>>0;}
 return "src_"+String(source).toLowerCase()+"_"+a.toString(36)+b.toString(36);
}
const canonicalStatus=value=>{
 const status=String(value||"").toUpperCase();
 if(["ACCEPTED","OPEN","NEW","PENDING"].includes(status))return "PENDING";
 if(["PARTIALLY_FILLED","PARTIAL_FILLED","PARTIAL"].includes(status))return "PARTIALLY_FILLED";
 if(["FILLED","COMPLETE","COMPLETED"].includes(status))return "FILLED";
 if(["REJECTED","FAILED"].includes(status))return "REJECTED";
 if(["CANCELLED","CANCELED"].includes(status))return "CANCELLED";
 return status;
};
const time=value=>{
 if(typeof value!=="string"||!Number.isFinite(Date.parse(value)))throw new Error("INVALID_DEMO_EVENT_TIMESTAMP");
 return value;
};
function getStore(){
 if(projection)return projection;
 const api=window.ZenuraDemoTradeHistory;
 if(!api?.createDemoTradeHistoryStore)throw new Error("DEMO_TRADE_HISTORY_STORE_UNAVAILABLE");
 projection=api.createDemoTradeHistoryStore();
 return projection;
}

function syncDemoProjection(source,snapshot){
 const store=getStore(),orders=snapshot.orders||[],facts=[];
 for(const order of orders){
  const assetClass=source==="EQUITY"?"EQUITY":order.assetClass;
  if(!["EQUITY","FUTURE","OPTION"].includes(assetClass))continue;
  facts.push({type:"ORDER",at:time(order.createdAt),order,assetClass});
  const fills=source==="EQUITY"?(snapshot.fills||[]).filter(fill=>fill.orderId===order.orderId):(order.fills||[]);
  for(const fill of fills)facts.push({type:"FILL",at:time(fill.filledAt||fill.executedAt),order,fill,assetClass});
  if(canonicalStatus(order.status)==="REJECTED")facts.push({type:"REJECT",at:time(order.updatedAt||order.createdAt),order});
  if(canonicalStatus(order.status)==="CANCELLED")facts.push({type:"CANCEL",at:time(order.updatedAt||order.createdAt),order});
 }
 const priority={ORDER:0,FILL:1,REJECT:2,CANCEL:2};
 facts.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||priority[a.type]-priority[b.type]||
  String(a.order.orderId).localeCompare(String(b.order.orderId))||
  String(a.fill?.fillId||"").localeCompare(String(b.fill?.fillId||"")));
 for(const fact of facts){
  const order=fact.order;
  if(fact.type==="ORDER"){
   store.submit({orderId:order.orderId,assetClass:fact.assetClass,side:order.side,orderType:order.orderType,
    product:order.product||"DELIVERY",instrumentKey:order.instrumentKey,quantity:order.quantity,
    limitPricePaise:order.limitPricePaise||undefined,idempotencyKey:cleanKey(source,order.orderId),
    createdAt:time(order.createdAt)});
  }else if(fact.type==="FILL"){
   store.recordFill({orderId:order.orderId,fillId:fact.fill.fillId,quantity:fact.fill.quantity,
    pricePaise:fact.fill.pricePaise,filledAt:fact.at});
  }else if(fact.type==="REJECT"){
   store.reject(order.orderId,order.rejectionReason||"Rejected by deterministic Demo simulator",fact.at);
  }else if(fact.type==="CANCEL"){
   store.cancel(order.orderId,fact.at);
  }
 }
 return store.snapshot();
}
function appendUnifiedDemoSummary(container,screen){
 const snap=getStore().snapshot(),host=document.createElement("section");
 host.className="demo-unified-history";
 const title=document.createElement("h3");
 title.textContent=screen==="trades"?"CANONICAL TRADE RECEIPTS":screen==="positions"||screen==="portfolio"?"CANONICAL POSITIONS":screen==="holdings"?"CANONICAL DELIVERY HOLDINGS":"CANONICAL DEMO ORDERS";
 host.append(title);
 const disclaimer=document.createElement("p");disclaimer.className="demo-eq-disclaimer";
 disclaimer.textContent="One append-only DEMO event projection shared by Equity, Futures and Options. Synthetic records only; Wallet and production execution remain separate.";
 host.append(disclaimer);
 const rows=screen==="trades"?snap.trades.map(x=>[x.fillId,x.assetClass,x.instrumentKey,x.side,x.quantity,x.pricePaise,x.grossValuePaise,x.filledAt]):
  screen==="positions"||screen==="portfolio"||screen==="holdings"?snap.positions.filter(x=>screen!=="holdings"||(x.assetClass==="EQUITY"&&x.product==="DELIVERY")).map(x=>[x.assetClass,x.instrumentKey,x.product,x.quantity,x.averagePricePaise,x.costBasisPaise,x.realizedPnlPaise]):
  snap.orders.map(x=>[x.orderId,x.assetClass,x.instrumentKey,x.side,x.orderType,x.quantity,x.filledQuantity+"/"+x.remainingQuantity,x.status]);
 const headers=screen==="trades"?["FILL ID","ASSET","INSTRUMENT","SIDE","QTY","PRICE (PAISE)","GROSS (PAISE)","FILLED AT"]:
  screen==="positions"||screen==="portfolio"||screen==="holdings"?["ASSET","INSTRUMENT","PRODUCT","NET QTY","AVG (PAISE)","COST (PAISE)","REALIZED P&L (PAISE)"]:
  ["ORDER ID","ASSET","INSTRUMENT","SIDE","TYPE","QTY","FILLED / REMAINING","STATUS"];
 const wrap=document.createElement("div");wrap.className="table-wrap";const table=document.createElement("table"),thead=document.createElement("thead"),trh=document.createElement("tr"),tbody=document.createElement("tbody");
 for(const h of headers){const th=document.createElement("th");th.textContent=h;trh.append(th);}thead.append(trh);
 for(const row of rows){const tr=document.createElement("tr");for(const value of row){const td=document.createElement("td");td.textContent=String(value??"—");tr.append(td);}tbody.append(tr);}
 if(!rows.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=headers.length;td.textContent="No canonical DEMO records yet.";tr.append(td);tbody.append(tr);}
 table.append(thead,tbody);wrap.append(table);host.append(wrap);container.append(host);
}
export function getDemoProjectionSnapshot(){return getStore().snapshot();}
export {syncDemoProjection,appendUnifiedDemoSummary};
