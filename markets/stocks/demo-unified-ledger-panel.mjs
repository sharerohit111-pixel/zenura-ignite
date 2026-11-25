import { getSharedPaperDemoLedgerSession } from "../shared/paper-demo-ledger-session.mjs";

let dataPromise = null;

export const EQUITY_MARK_MAX_AGE_MS = 60_000;
export const DERIVATIVE_MARK_MAX_AGE_MS = 15_000;
export const EQUITY_MARK_MAX_FUTURE_SKEW_MS = 5_000;
export const NSE_REVISED_DERIVATIVES_HOURS_EFFECTIVE_DATE = "2026-12-07";
export const BSE_REVISED_DERIVATIVES_HOURS_EFFECTIVE_DATE = "2026-12-07";
export const DERIVATIVE_CALENDAR_VERIFIED_YEAR = 2026;

// Official 2026 exchange holiday notices. Muhurat Trading is deliberately
// excluded from regular expiry valuation because its segment/session timings
// are separately notified and are not a regular derivatives session.
const NSE_DERIVATIVES_HOLIDAYS_2026 = new Set([
  "2026-01-15", "2026-01-26", "2026-03-03", "2026-03-26", "2026-03-31",
  "2026-04-03", "2026-04-14", "2026-05-01", "2026-05-28", "2026-06-26",
  "2026-09-14", "2026-10-02", "2026-10-20", "2026-11-10", "2026-11-24",
  "2026-12-25"
]);
const BSE_DERIVATIVES_HOLIDAYS_2026 = new Set([
  "2026-01-26", "2026-03-03", "2026-03-26", "2026-03-31", "2026-04-03",
  "2026-04-14", "2026-05-01", "2026-05-28", "2026-06-26", "2026-09-14",
  "2026-10-02", "2026-10-20", "2026-11-10", "2026-11-24", "2026-12-25"
]);
const SPECIAL_SESSION_DATES_2026 = new Set(["2026-11-08"]);

export function isVerifiedRegularDerivativeExpiryDate(expiryDate, exchange) {
  if (typeof expiryDate !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(expiryDate)) return false;
  const [year, month, day] = expiryDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || year !== DERIVATIVE_CALENDAR_VERIFIED_YEAR) return false;
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6 || SPECIAL_SESSION_DATES_2026.has(expiryDate)) return false;
  if (exchange === "NSE") return !NSE_DERIVATIVES_HOLIDAYS_2026.has(expiryDate);
  if (exchange === "BSE") return !BSE_DERIVATIVES_HOLIDAYS_2026.has(expiryDate);
  return false;
}

// Exchange-specific expiry cutoffs. Calendar dates outside the verified
// exchange calendar and all non-regular sessions fail closed.
export function portfolioDerivativeExpiryCutoff(expiryDate, { exchange, underlyingType } = {}) {
  if (!isVerifiedRegularDerivativeExpiryDate(expiryDate, exchange)) return null;

  let hour;
  let minute;
  if (expiryDate < NSE_REVISED_DERIVATIVES_HOURS_EFFECTIVE_DATE) {
    hour = 15;
    minute = 30;
  } else if (underlyingType === "INDEX") {
    hour = 15;
    minute = 30;
  } else if (underlyingType === "STOCK") {
    hour = 15;
    minute = 45;
  } else {
    return null;
  }
  if (exchange !== "NSE" && exchange !== "BSE") return null;

  const clock = String(hour).padStart(2, "0") + ":" +
    String(minute).padStart(2, "0") + ":00+05:30";
  const cutoff = Date.parse(expiryDate + "T" + clock);
  return Number.isFinite(cutoff) ? cutoff : null;
}

export function createPortfolioMark(pricePaise, timestamp, {
  explicitStale = false, envelopeStale = false, now = Date.now(),
  maxAgeMs, maxFutureSkewMs = 0, expiryDate = null, exchange = null, underlyingType = null, requiresExpiry = false
} = {}) {
  const time = typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
  const priceValid = Number.isSafeInteger(pricePaise) && pricePaise > 0;
  const timeValid = Number.isFinite(time) && time > 0 && Number.isFinite(now) &&
    Number.isFinite(maxAgeMs) && maxAgeMs >= 0 && Number.isFinite(maxFutureSkewMs) && maxFutureSkewMs >= 0;
  const ageMs = timeValid ? now - time : null;
  const expiryCutoff = requiresExpiry ? portfolioDerivativeExpiryCutoff(expiryDate, { exchange, underlyingType }) : null;
  const expiryValid = !requiresExpiry || expiryCutoff !== null;
  const stale = explicitStale === true || envelopeStale === true || !priceValid || !timeValid ||
    !expiryValid || (requiresExpiry && now >= expiryCutoff) ||
    ageMs > maxAgeMs || ageMs < -maxFutureSkewMs;
  return {
    pricePaise: priceValid ? pricePaise : null,
    timestamp: timeValid ? time : null,
    stale,
    maxAgeMs: Number.isFinite(maxAgeMs) && maxAgeMs >= 0 ? maxAgeMs : null,
    maxFutureSkewMs: Number.isFinite(maxFutureSkewMs) && maxFutureSkewMs >= 0 ? maxFutureSkewMs : null,
    expiryDate,
    exchange,
    underlyingType,
    requiresExpiry
  };
}

// Re-evaluate age at every valuation. A mark that was fresh when fetched must
// expire as wall-clock time advances; cached quote snapshots are not leases.
export function isUsablePortfolioMark(mark, now = Date.now()) {
  if (!mark || !Number.isSafeInteger(mark.pricePaise) || mark.pricePaise <= 0 ||
      mark.stale !== false || !Number.isFinite(mark.timestamp) || !Number.isFinite(now) ||
      !Number.isFinite(mark.maxAgeMs) || mark.maxAgeMs < 0 ||
      !Number.isFinite(mark.maxFutureSkewMs) || mark.maxFutureSkewMs < 0) return false;
  const ageMs = now - mark.timestamp;
  if (ageMs > mark.maxAgeMs || ageMs < -mark.maxFutureSkewMs) return false;
  if (mark.requiresExpiry === true) {
    const expiryCutoff = portfolioDerivativeExpiryCutoff(mark.expiryDate, { exchange: mark.exchange, underlyingType: mark.underlyingType });
    if (expiryCutoff === null || now >= expiryCutoff) return false;
  }
  return true;
}

export function calculateAggregateUnrealized(positions, marks, now = Date.now()) {
  let value = 0;
  for (const position of positions) {
    const mark = marks.get(position.instrumentKey);
    if (!isUsablePortfolioMark(mark, now) || !Number.isSafeInteger(position.quantity) ||
        !Number.isSafeInteger(position.averagePricePaise)) return { complete: false, value: null };
    const pnl = (mark.pricePaise - position.averagePricePaise) * position.quantity;
    if (!Number.isSafeInteger(pnl) || !Number.isSafeInteger(value + pnl)) return { complete: false, value: null };
    value += pnl;
  }
  return { complete: true, value };
}

export function portfolioMarketValueDisplay(position, mark, now = Date.now()) {
  if (position?.assetClass === "FUTURE") return "Not applicable (Futures MTM)";
  if (!isUsablePortfolioMark(mark, now) || !Number.isSafeInteger(position?.quantity)) return "—";
  const value = mark.pricePaise * position.quantity;
  return Number.isSafeInteger(value) ? money(value) : "—";
}

export function schedulePortfolioMarkExpiryRefresh({
  section, marks, render, now = Date.now, setTimer = setTimeout,
  clearTimer = clearTimeout, doc = globalThis.document
} = {}) {
  if (typeof doc?.addEventListener !== "function" || typeof doc?.removeEventListener !== "function") {
    return () => {};
  }
  let timer = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
    doc?.removeEventListener?.("visibilitychange", onVisibilityChange);
  };
  const schedule = () => {
    if (disposed) return;
    if (timer !== null) clearTimer(timer);
    timer = null;
    const currentTime = now();
    let nextExpiry = null;
    for (const mark of marks?.values?.() ?? []) {
      if (!isUsablePortfolioMark(mark, currentTime)) continue;
      const ageExpiry = mark.timestamp + mark.maxAgeMs + 1;
      const contractExpiry = mark.requiresExpiry === true
        ? portfolioDerivativeExpiryCutoff(mark.expiryDate, { exchange: mark.exchange, underlyingType: mark.underlyingType }) : null;
      const expiry = contractExpiry === null ? ageExpiry : Math.min(ageExpiry, contractExpiry);
      nextExpiry = nextExpiry === null ? expiry : Math.min(nextExpiry, expiry);
    }
    if (nextExpiry !== null) {
      timer = setTimer(refresh, Math.max(0, nextExpiry - currentTime));
    }
  };
  const refresh = () => {
    if (disposed) return;
    if (section?.isConnected === false) {
      dispose();
      return;
    }
    render(now());
    schedule();
  };
  const onVisibilityChange = () => {
    if (doc?.visibilityState === "visible") refresh();
  };
  doc?.addEventListener?.("visibilitychange", onVisibilityChange);
  schedule();
  return dispose;
}

export function accountRealizedPnlPaise(snapshot) {
  const value = snapshot?.account?.realizedPnlPaise;
  return Number.isSafeInteger(value) ? value : null;
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
    const contractsByKey = new Map((derivativeEnvelope.data.contracts ?? [])
      .map(contract => [contract.instrumentKey, contract]));
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
        maxAgeMs:DERIVATIVE_MARK_MAX_AGE_MS,
        expiryDate:contractsByKey.get(quote.instrumentKey)?.expiry ?? null,
        exchange:contractsByKey.get(quote.instrumentKey)?.exchange ?? null,
        underlyingType:contractsByKey.get(quote.instrumentKey)?.underlyingType ?? null,
        requiresExpiry:true
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
      const renderPortfolio = now => {
        const rows=positions.map(position=>{
          const mark=marks.get(position.instrumentKey);
          const valid=isUsablePortfolioMark(mark,now) &&
            Number.isSafeInteger(position.averagePricePaise) &&
            Number.isSafeInteger((mark.pricePaise-position.averagePricePaise)*position.quantity);
          const unrealized=valid?(mark.pricePaise-position.averagePricePaise)*position.quantity:null;
          return [
            position.assetClass,symbols.get(position.instrumentKey)||position.symbol||position.instrumentKey,
            position.product,position.quantity,money(position.averagePricePaise),
            valid?money(mark.pricePaise):"Unavailable (missing/stale/expired)",money(position.costBasisPaise),
            portfolioMarketValueDisplay(position,mark,now),money(position.realizedPnlPaise),valid?money(unrealized):"Unavailable"
          ];
        });
        table(host,["ASSET","INSTRUMENT","PRODUCT","NET QTY","AVG PRICE","MOCK MARK","COST BASIS","MARK VALUE","REALIZED P&L","UNREALIZED P&L"],rows,
          screen==="holdings"?"No Equity Delivery holdings yet.":"No shared Demo positions yet.");
        const aggregate=calculateAggregateUnrealized(positions,marks,now);
        host.append(el("p","demo-eq-disclaimer","Aggregate unrealized P&L: "+
          (aggregate.complete?money(aggregate.value):"Unavailable (one or more marks missing/stale)")+
          " · Account realized P&L: "+money(accountRealizedPnlPaise(snapshot))));
        const totals=el("div","demo-eq-disclaimer",
          "Ledger events: "+snapshot.events.length+" · Account cash: "+money(snapshot.account.cashBalancePaise)+
          " · Available: "+money(snapshot.account.availableFundsPaise)+" · Realized P&L: "+money(snapshot.account.realizedPnlPaise)+
          " · Reconciled: "+String(snapshot.account.ledgerReconciled));
        host.append(totals);
      };
      renderPortfolio(Date.now());
      schedulePortfolioMarkExpiryRefresh({section,marks,render:renderPortfolio});
    }
  } catch(error) {
    host.append(el("p","demo-eq-status","Unified Demo ledger unavailable · "+(error.message||"fixture error")));
  }
}
