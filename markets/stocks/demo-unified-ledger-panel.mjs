import { getSharedPaperDemoLedgerSession } from "../shared/paper-demo-ledger-session.mjs";
import { projectPaperDemoWallet } from "../shared/paper-demo-wallet-projection.mjs";

let dataPromise = null;
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
    marks.set(equityEnvelope.data.instrument.instrumentKey,equityEnvelope.data.instrument.markPricePaise);
    for(const quote of derivativeEnvelope.data.quotes) {
      marks.set(quote.instrumentKey,Math.round((quote.bidPricePaise+quote.askPricePaise)/2));
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
        const unrealized=Number.isSafeInteger(mark)
          ? (mark-position.averagePricePaise)*position.quantity : null;
        const markValue=Number.isSafeInteger(mark)?mark*position.quantity:null;
        return [
          position.assetClass,symbols.get(position.instrumentKey)||position.symbol||position.instrumentKey,
          position.product,position.quantity,money(position.averagePricePaise),
          Number.isSafeInteger(mark)?money(mark):"—",money(position.costBasisPaise),
          Number.isSafeInteger(markValue)?money(markValue):"—",money(position.realizedPnlPaise),
          Number.isSafeInteger(unrealized)?money(unrealized):"—"
        ];
      });
      table(host,["ASSET","INSTRUMENT","PRODUCT","NET QTY","AVG PRICE","MOCK MARK","COST BASIS","MARK VALUE","REALIZED P&L","UNREALIZED P&L"],rows,
        screen==="holdings"?"No Equity Delivery holdings yet.":"No shared Demo positions yet.");
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


export async function appendWalletSummary(container) {
  const section = el("section", "demo-unified-ledger");
  section.append(el("h3", "demo-eq-subhead", "CANONICAL VIRTUAL WALLET"));
  section.append(el("p", "demo-eq-disclaimer",
    "Read-only wallet projection from the same account/session event ledger used by Equity, Futures and Options. MOCK only; no cash mutation, fees, margin inference or settlement authority."));
  const host = el("div");
  section.append(host);
  container.append(section);
  try {
    const { session } = await getData();
    const wallet = projectPaperDemoWallet(session.ledger.snapshot());
    host.append(el("div", "demo-wallet-identity",
      "Account " + wallet.account.accountId + " · Session " + wallet.account.sessionId));
    const cards = el("div", "grid");
    cards.append(
      el("article", "card"),
      el("article", "card"),
      el("article", "card"),
      el("article", "card")
    );
    const values = [
      ["Opening cash", money(wallet.account.openingCashPaise)],
      ["Cash balance", money(wallet.account.cashBalancePaise)],
      ["Blocked funds", money(wallet.account.blockedFundsPaise)],
      ["Available funds", money(wallet.account.availableFundsPaise)]
    ];
    [...cards.children].forEach((node, index) => {
      node.append(el("h3", "", values[index][0]), el("div", "metric", values[index][1]));
    });
    host.append(cards);
    const orderRows = wallet.orders.map(order => [
      order.orderId, order.assetClass, order.symbol || order.instrumentKey, order.side,
      order.orderType, order.quantity, order.filledQuantity + " / " + order.remainingQuantity,
      order.averageFillPricePaise ? money(order.averageFillPricePaise) : "—", order.status
    ]);
    const orderTable = el("div");
    table(orderTable, ["ORDER ID","ASSET","INSTRUMENT","SIDE","TYPE","QTY","FILLED / REMAINING","AVG FILL","STATUS"], orderRows,
      "No canonical Demo orders yet.");
    host.append(el("h3", "demo-eq-subhead", "ORDERS"), orderTable);
    const fillRows = wallet.fills.map(fill => [
      fill.fillId, fill.assetClass, fill.symbol || fill.instrumentKey, fill.side,
      fill.quantity, money(fill.pricePaise), money(fill.quantity * fill.pricePaise),
      fill.occurredAt || fill.executedAt
    ]);
    const fillTable = el("div");
    table(fillTable, ["FILL ID","ASSET","INSTRUMENT","SIDE","QTY","PRICE","GROSS","TIME"], fillRows,
      "No canonical Demo fills yet.");
    host.append(el("h3", "demo-eq-subhead", "FILL RECEIPTS"), fillTable);
    const positionRows = wallet.positions.filter(position => position.quantity !== 0).map(position => [
      position.assetClass, position.symbol || position.instrumentKey, position.product,
      position.quantity, money(position.averagePricePaise), money(position.costBasisPaise),
      money(position.realizedPnlPaise), position.reservedQuantity
    ]);
    const positionTable = el("div");
    table(positionTable, ["ASSET","INSTRUMENT","PRODUCT","NET QTY","AVG PRICE","COST BASIS","REALIZED P&L","RESERVED"], positionRows,
      "No canonical Demo positions yet.");
    host.append(el("h3", "demo-eq-subhead", "POSITIONS"), positionTable);
    host.append(el("p", "demo-eq-disclaimer",
      "Events: " + wallet.eventCount + " · Last sequence: " + wallet.lastSequence +
      " · Reconciled: false (intentionally fail-closed). Unrealized P&L is not valued here."));
  } catch (error) {
    host.append(el("p", "demo-eq-status",
      "Canonical wallet projection unavailable · " + (error.message || "fixture error") +
      ". No fixture-balance fallback is shown."));
  }
}
