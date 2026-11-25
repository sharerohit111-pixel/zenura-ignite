"use strict";
let projection=null;
const cleanKey=value=>("src_"+String(value).replace(/[^A-Za-z0-9_-]/g,"_")).slice(0,80);
const time=value=>typeof value==="string"&&Number.isFinite(Date.parse(value))?value:new Date(0).toISOString();
function getStore(){
 if(projection)return projection;
 const api=window.ZenuraDemoTradeHistory;
 if(!api?.createDemoTradeHistoryStore)throw new Error("DEMO_TRADE_HISTORY_STORE_UNAVAILABLE");
 projection=api.createDemoTradeHistoryStore({env:{NODE_ENV:"development"}});
 return projection;
}

function syncDemoProjection(source,snapshot){
 const store=getStore(),orders=source==="EQUITY"?(snapshot.orders||[]):(snapshot.orders||[]);
 for(const order of [...orders].reverse()){
  const assetClass=source==="EQUITY"?"EQUITY":order.assetClass;
  if(!["EQUITY","FUTURE","OPTION"].includes(assetClass))continue;
  store.submit({orderId:order.orderId,assetClass,side:order.side,orderType:order.orderType,
   product:order.product||"DELIVERY",instrumentKey:order.instrumentKey,quantity:order.quantity,
   limitPricePaise:order.limitPricePaise||undefined,idempotencyKey:cleanKey(order.orderId),
   createdAt:time(order.createdAt)});
  if(order.status==="REJECTED"){
   store.reject(order.orderId,order.rejectionReason||"Rejected by deterministic Demo simulator",time(order.updatedAt||order.createdAt));
  }
  const fills=source==="EQUITY"?(snapshot.fills||[]).filter(f=>f.orderId===order.orderId):(order.fills||[]);
  for(const fill of fills){
   store.recordFill({orderId:order.orderId,fillId:fill.fillId,quantity:fill.quantity,
    pricePaise:fill.pricePaise,filledAt:time(fill.filledAt||fill.executedAt)});
  }
  if(order.status==="CANCELLED"){
   store.cancel(order.orderId,time(order.updatedAt));
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
