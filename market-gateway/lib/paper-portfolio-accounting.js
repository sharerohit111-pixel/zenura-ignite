"use strict";
const ASSETS = new Set(["EQUITY","FUTURES","OPTIONS"]);
const OPEN = new Set(["PENDING","PARTIALLY_FILLED"]);
function fail(message){throw Object.assign(new Error(message),{status:422,code:"PAPER_PORTFOLIO_INVALID"});}
function money(v,label,signed=false){if(!Number.isSafeInteger(v)||(!signed&&v<0))fail(label+" must be a safe integer in paise.");return v;}
function add(a,b,label){const n=a+b;if(!Number.isSafeInteger(n))fail(label+" exceeds safe integer range.");return n;}
function id(v,label){if(typeof v!=="string"||!v.trim())fail(label+" is missing.");return v;}
function buildPaperPortfolioAccounting({account,assetSnapshots,mode="PERSISTED",now=Date.now(),maxQuoteAgeMs=15000}){
 if(!account||!Array.isArray(assetSnapshots)||!assetSnapshots.length)fail("Account and asset snapshots are required.");
 if(!["PERSISTED","DUMMY"].includes(mode))fail("Invalid portfolio mode.");
 money(now,"Snapshot time");money(maxQuoteAgeMs,"Maximum quote age");
 const startingCapitalPaise=money(account.starting_cash_paise,"Starting capital");
 const cashPaise=money(account.cash_paise,"Cash balance",true);
 const reservedCashPaise=money(account.reserved_cash_paise??0,"Reserved cash");
 const reservedMarginPaise=money(account.reserved_margin_paise??0,"Reserved margin");
 const availableCashPaise=cashPaise-reservedCashPaise-reservedMarginPaise;
 if(!Number.isSafeInteger(availableCashPaise))fail("Available cash exceeds safe integer range.");
 const minimumCashDeficitPaise=Math.max(0,-availableCashPaise);
 const marginDeficitPaise=money(account.margin_deficit_paise??minimumCashDeficitPaise,"Margin deficit");
 if(marginDeficitPaise<minimumCashDeficitPaise)fail("Margin deficit cannot be lower than the negative available-cash deficit.");
 const assets=new Set(),positions=[],orders=[],trades=[],positionIds=new Set(),orderIds=new Set(),tradeIds=new Set();
 let complete=true,stale=0,marketValue=0,unrealized=0,realized=0,charges=0,unpriced=false;
 for(const s of assetSnapshots){
  if(!s||!ASSETS.has(s.asset)||assets.has(s.asset)||!Array.isArray(s.positions)||!Array.isArray(s.orders)||!Array.isArray(s.trades)||typeof s.complete!=="boolean")fail("Invalid or duplicate asset adapter snapshot.");
  assets.add(s.asset);complete=complete&&s.complete;
  for(const p of s.positions){
   if(!p||p.asset!==s.asset)fail("Position asset does not match adapter.");
   const positionId=id(p.positionId,"Position ID"),quantity=money(p.quantity,"Position quantity"),costBasisPaise=money(p.costBasisPaise,"Position cost basis");
   if(!["LONG","SHORT"].includes(p.side))fail("Position side must be LONG or SHORT.");
   if(positionIds.has(positionId))fail("Duplicate position ID across assets.");positionIds.add(positionId);
   if(quantity<1)fail("Open position quantity must be positive.");
   let row={...p,positionId,costBasisPaise};
   if(p.quoteStatus==="fresh"){
    const price=money(p.marketPricePaise,"Market price"),at=money(p.quoteTimestampMs,"Quote timestamp");
    if(at>now||now-at>maxQuoteAgeMs){row={...row,quoteStatus:"stale",marketPricePaise:null,marketValuePaise:null,unrealizedPnlPaise:null};stale++;unpriced=true;}
    else{const value=money(p.marketValuePaise,"Market value"),pnl=money(p.unrealizedPnlPaise,"Unrealized P&L",true);
     const expectedPnl=p.side==="SHORT"?costBasisPaise-value:value-costBasisPaise;
     if(!Number.isSafeInteger(price*quantity)||value!==price*quantity||pnl!==expectedPnl)fail("Position valuation does not reconcile.");
     marketValue=add(marketValue,value,"Market value");unrealized=add(unrealized,pnl,"Unrealized P&L");}
   }else{row={...row,quoteStatus:p.quoteStatus||"unavailable",marketPricePaise:null,marketValuePaise:null,unrealizedPnlPaise:null};stale++;unpriced=true;}
   positions.push(row);
  }
  for(const o of s.orders){if(!o||o.asset!==s.asset)fail("Order asset does not match adapter.");const orderId=id(o.orderId,"Order ID");if(orderIds.has(orderId))fail("Duplicate order ID across assets.");orderIds.add(orderId);money(o.remainingQuantity??0,"Remaining order quantity");if(typeof o.status!=="string")fail("Order status missing.");orders.push({...o,orderId});}
  for(const t of s.trades){if(!t||t.asset!==s.asset)fail("Trade asset does not match adapter.");const tradeId=id(t.tradeId,"Trade ID");if(tradeIds.has(tradeId))fail("Duplicate trade ID across assets.");tradeIds.add(tradeId);const c=money(t.chargesPaise??0,"Trade charges"),r=money(t.realizedPnlPaise??0,"Realized P&L",true);charges=add(charges,c,"Charges");realized=add(realized,r,"Realized P&L");trades.push({...t,tradeId,chargesPaise:c,realizedPnlPaise:r});}
 }
 if(assets.size!==ASSETS.size)fail("Equity, Futures and Options snapshots are all required; use empty snapshots for unused assets.");
 positions.sort((a,b)=>a.asset.localeCompare(b.asset)||String(a.symbol||"").localeCompare(String(b.symbol||"")));
 orders.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))||a.orderId.localeCompare(b.orderId));
 trades.sort((a,b)=>String(b.executedAt||"").localeCompare(String(a.executedAt||""))||a.tradeId.localeCompare(b.tradeId));
 const holdings=positions.filter(p=>p.asset==="EQUITY"&&(p.product==="DELIVERY"||p.positionType==="HOLDING"));
 return Object.freeze({mode,simulationOnly:mode==="DUMMY",startingCapitalPaise,cashPaise,reservedCashPaise,reservedMarginPaise,blockedFundsPaise:add(reservedCashPaise,reservedMarginPaise,"Blocked funds"),availableCashPaise,marginDeficitPaise,positions,holdings,orders,activeOrders:orders.filter(o=>OPEN.has(o.status)),trades,marketValuePaise:unpriced?null:marketValue,unrealizedPnlPaise:unpriced?null:unrealized,realizedPnlPaise:realized,chargesPaidPaise:charges,netPnlPaise:complete&&!unpriced?add(add(realized,unrealized,"Gross P&L"),-charges,"Net P&L after charges"):null,stalePositions:stale,valuationStatus:!positions.length?"empty":unpriced?"partial_or_stale":"fresh",reconciliationStatus:complete?"complete":"incomplete",sourceAssets:[...assets].sort()});
}
module.exports={buildPaperPortfolioAccounting};
