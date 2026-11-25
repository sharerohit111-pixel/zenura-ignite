import { getSharedPaperDemoLedgerSession } from "../shared/paper-demo-ledger-session.mjs";

let dataPromise = null;

export const EQUITY_MARK_MAX_AGE_MS = 60_000;
export const DERIVATIVE_MARK_MAX_AGE_MS = 15_000;
export const EQUITY_MARK_MAX_FUTURE_SKEW_MS = 5_000;

export function createPortfolioMark(pricePaise, timestamp, {
  explicitStale = false, envelopeStale = false, now = Date.now(),
  maxAgeMs, maxFutureSkewMs = 0
} = {}) {
  const time = typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
  const priceValid = Number.isSafeInteger(pricePaise) && pricePaise > 0;
  const timeValid = Number.isFinite(time) && time > 0 && Number.isFinite(now) &&
    Number.isFinite(maxAgeMs) && maxAgeMs >= 0 && Number.isFinite(maxFutureSkewMs) && maxFutureSkewMs >= 0;
  const ageMs = timeValid ? now - time : null;
  const stale = explicitStale === true || envelopeStale === true || !priceValid || !timeValid ||
    ageMs > maxAgeMs || ageMs < -maxFutureSkewMs;
  return { pricePaise: priceValid ? pricePaise : null, timestamp: timeValid ? time : null, stale };
}

export function isUsablePortfolioMark(mark) {
  return Boolean(mark && Number.isSafeInteger(mark.pricePaise) && mark.pricePaise > 0 &&
    mark.stale === false && Number.isFinite(mark.timestamp));
}

export function calculateAggregateUnrealized(positions, marks) {
  let value = 0;
  for (const position of positions) {
    const mark = marks.get(position.instrumentKey);
    if (!isUsablePortfolioMark(mark) || !Number.isSafeInteger(position.quantity) ||
        !Number.isSafeInteger(position.averagePricePaise)) return { complete: false, value: null };
    const pnl = (mark.pricePaise - position.averagePricePaise) * position.quantity;
    if (!Number.isSafeInteger(pnl) || !Number.isSafeInteger(value + pnl)) return { complete: false, value: null };
    value += pnl;
  }
  return { complete: true, value };
}
const money = value => Number.isSafeInteger(value)
  ? "₹" + (value / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : "—";
const el = (tag, cls, value) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined) node.textContent = String(value);
  return node;
};
function table(host, headers, rows, empty) {
  const wrap=el("div","table-wrap demo-unified-table-wrap"),t=el("table"),head=el("thead"),hr=el("tr"),body=el("tbody");
  headers.forEach(value=>hr.append(el("th","",value)));head.append(hr);
  if(!rows.length){const tr=el("tr"),td=el("td","empty",empty);td.colSpan=headers.length;tr.append(td);body.append(tr);}
  else rows.forEach(row=>{const tr=el("tr");row.forEach(value=>tr.append(el("td","",value??"—")));body.append(tr);});
  t.append(head,body);wrap.append(t);host.replaceChildren(wrap);
}
async function getData() {
  if (!dataPromise) dataPromise = Promise.all([
    fetch(new URL("../../market-gateway/mock/fixtures/account.json", import.meta.url), { method:"GET", credentials:"omit", cache:"no-store", headers:{Accept:"application/json"} }),
    fetch(new URL("../../market-gateway/mock/fixtures/equity-execution.json", import.meta.url), { method:"GET", credentials:"omit", cache:"no-store", headers:{Accept:"application/json"} }),
    fetch(new URL("../../market-gateway/mock/fixtures/derivatives.json", import.meta.url), { method:"GET", credentials:"omit", cache:"no-store", headers:{Accept:"application/json"} })
  ]).then(async responses => {
    if (responses.some(response=>!response.ok)) throw new Error("SHARED_DEMO_FIXTURE_UNAVAILABLE");
    const [accountEnvelope,equityEnvelope,derivativeEnvelope] = await Promise.all(responses.map(response=>response.json()));
    if(accountEnvelope?.mode!=="MOCK"||accountEnvelope?.simulated!==true||accountEnvelope?.meta?.source!=="SYNTHETIC_FIXTURE") {
      throw new Error("INVALID_SHARED_DEMO_ACCOUNT_FIXTURE");
    }
    const session=getSharedPaperDemoLedgerSession({
      accountId:accountEnvelope.data.accountId,
      cashBalancePaise:accountEnvelope.data.cashBalancePaise,
      blockedFundsPaise:accountEnvelope.data.blockedFundsPaise
    });
    const marks=new Map();
    marks.set(equityEnvelope.data.instrument.instrumentKey,
      createPortfolioMark(equityEnvelope.data.instrument.markPricePaise,equityEnvelope.asOf,{
        explicitStale:equityEnvelope.meta?.stale===true,
        envelopeStale:equityEnvelope.meta?.stale===true,
        maxAgeMs:EQUITY_MARK_MAX_AGE_MS,
        maxFutureSkewMs:EQUITY_MARK_MAX_FUTURE_SKEW_MS
      }));
    for(const quote of derivativeEnvelope.data.quotes) {
      const midpoint=Number.isSafeInteger(quote.bidPricePaise)&&Number.isSafeInteger(quote.askPricePaise)
        ? Math.round((quote.bidPricePaise+quote.askPricePaise)/2) : null;
      marks.set(quote.instrumentKey,createPortfolioMark(midpoint,quote.timestamp,{
        explicitStale:quote.stale===true,
        envelopeStale:derivativeEnvelope.meta?.stale===true,
        maxAgeMs:DERIVATIVE_MARK_MAX_AGE_MS
      }));
    }
    const symbols=new Map();
    for(const contract of derivativeEnvelope.data.contracts) symbols.set(contract.instrumentKey,contract.symbol);
    symbols.set(equityEnvelope.data.instrument.instrumentKey,equityEnvelope.data.instrument.symbol);
    return {session,marks,symbols};
  });
  return dataPromise;
}

export async function appendUnifiedLedgerSummary(container, screen) {
  const section=el("section","demo-unified-ledger");
  const heading=screen==="trades"?"UNIFIED TRADE HISTORY":screen==="orders"?"UNIFIED ORDER HISTORY":
    screen==="holdings"?"DELIVERY HOLDINGS":"UNIFIED DEMO PORTFOLIO";
  section.append(el("h3","demo-eq-subhead",heading));
  section.append(el("p","demo-eq-disclaimer",
    "One shared account-scoped MOCK event ledger for Equity, Futures and Options. Synthetic marks only; derivative margin/charges are not modelled and ledgerReconciled remains false."));
  const host=el("div");section.append(host);container.append(section);
  try {
    const {session,marks,symbols}=await getData();
    const snapshot=session.ledger.snapshot();
    const supportedAssets=new Set(["EQUITY","FUTURE","OPTION"]);
    const positions=snapshot.positions.filter(position=>supportedAssets.has(position.assetClass)&&position.quantity!==0 &&
      (screen!=="holdings" || (position.assetClass==="EQUITY" && position.product==="DELIVERY")));
    if(screen==="trades") {
      const rows=snapshot.fills.slice().sort((a,b)=>a.sequence-b.sequence).map(fill=>[
        fill.fillId,fill.assetClass,fill.symbol||symbols.get(fill.instrumentKey)||fill.instrumentKey,
        fill.product,fill.side,fill.orderType,fill.quantity,money(fill.pricePaise),
        money(fill.grossPaise),money(fill.realizedPnlPaise||0),fill.executedAt||fill.occurredAt
      ]);
      table(host,["FILL ID","ASSET","INSTRUMENT","PRODUCT","SIDE","TYPE","QTY","PRICE","GROSS","REALIZED P&L","TIME"],rows,
        "No cross-asset fills yet. Submit a MOCK order in Equity, Futures or Options.");
    } else if(screen==="orders") {
      const rows=snapshot.orders.slice().sort((a,b)=>b.lastSequence-a.lastSequence).map(order=>[
        order.orderId,order.assetClass,order.symbol||symbols.get(order.instrumentKey)||order.instrumentKey,
        order.product,order.side,order.orderType,order.quantity,
        (order.filledQuantity||0)+" / "+(order.remainingQuantity??order.quantity),
        order.averageFillPricePaise?money(order.averageFillPricePaise):"—",order.status
      ]);
      table(host,["ORDER ID","ASSET","INSTRUMENT","PRODUCT","SIDE","TYPE","QTY","FILLED / REMAINING","AVG FILL","STATUS"],rows,
        "No shared Demo orders yet.");
    } else {
      const rows=positions.map(position=>{
        const mark=marks.get(position.instrumentKey);
        const valid=isUsablePortfolioMark(mark);
        const unrealized=valid?(mark.pricePaise-position.averagePricePaise)*position.quantity:null;
        const markValue=valid?mark.pricePaise*position.quantity:null;
        return [
          position.assetClass,symbols.get(position.instrumentKey)||position.symbol||position.instrumentKey,
          position.product,position.quantity,money(position.averagePricePaise),
          valid?money(mark.pricePaise):"Unavailable (missing/stale)",money(position.costBasisPaise),
          valid?money(markValue):"—",money(position.realizedPnlPaise),valid?money(unrealized):"Unavailable"
        ];
      });
      table(host,["ASSET","INSTRUMENT","PRODUCT","NET QTY","AVG PRICE","MOCK MARK","COST BASIS","MARK VALUE","REALIZED P&L","UNREALIZED P&L"],rows,
        screen==="holdings"?"No Equity Delivery holdings yet.":"No shared Demo positions yet.");
      const aggregate=calculateAggregateUnrealized(positions,marks);
      host.append(el("p","demo-eq-disclaimer","Aggregate unrealized P&L: "+
        (aggregate.complete?money(aggregate.value):"Unavailable (one or more marks missing/stale)")+
        " · Aggregate realized P&L: "+money(positions.reduce((sum,p)=>sum+p.realizedPnlPaise,0))));
    }
    const totals=el("div","demo-eq-disclaimer",
      "Ledger events: "+snapshot.events.length+" · Account cash: "+money(snapshot.account.cashBalancePaise)+
      " · Available: "+money(snapshot.account.availableFundsPaise)+" · Realized P&L: "+money(snapshot.account.realizedPnlPaise)+
      " · Reconciled: "+String(snapshot.account.ledgerReconciled));
    host.append(totals);
  } catch(error) {
    host.append(el("p","demo-eq-status","Unified Demo ledger unavailable · "+(error.message||"fixture error")));
  }
}
