import { createPaperDemoViewModel } from "../shared/paper-demo-adapter.mjs";
import { getDemoProjectionSnapshot } from "./demo-trade-projection.mjs";

export function buildDemoPortfolioView(snapshot, instruments, asOf) {
  if (!snapshot || snapshot.mode !== "DEMO" || snapshot.simulationOnly !== true ||
      !Array.isArray(snapshot.positions) || !Array.isArray(snapshot.orders) ||
      !Array.isArray(snapshot.trades) || !Array.isArray(instruments)) {
    throw new TypeError("INVALID_DEMO_PORTFOLIO_SNAPSHOT");
  }
  const referenceTime = Date.parse(asOf);
  if (!Number.isFinite(referenceTime)) throw new TypeError("INVALID_DEMO_PORTFOLIO_AS_OF");
  const marks = new Map(instruments.map(item => [item.instrumentKey, item]));
  const realizedPnlPaise = snapshot.positions.reduce((sum, position) => {
    if (!Number.isSafeInteger(position?.realizedPnlPaise)) throw new TypeError("INVALID_DEMO_POSITION");
    const next = sum + position.realizedPnlPaise;
    if (!Number.isSafeInteger(next)) throw new TypeError("DEMO_PORTFOLIO_TOTAL_OUT_OF_RANGE");
    return next;
  }, 0);
  let unrealizedPnlPaise = 0, valuationComplete = true;
  const positions = snapshot.positions.filter(position => position.quantity !== 0).map(position => {
    const instrument = marks.get(position.instrumentKey);
    const quantity = position.quantity;
    const averagePricePaise = position.averagePricePaise;
    if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(averagePricePaise) ||
        !Number.isSafeInteger(position.costBasisPaise) || position.costBasisPaise < 0 ||
        !Number.isSafeInteger(position.realizedPnlPaise) ||
        !["EQUITY", "FUTURE", "OPTION"].includes(position.assetClass) ||
        !["DELIVERY", "INTRADAY"].includes(position.product) ||
        typeof position.instrumentKey !== "string" || !position.instrumentKey.startsWith("MOCK|") ||
        (position.assetClass !== "FUTURE" && quantity < 0)) {
      throw new TypeError("INVALID_DEMO_POSITION");
    }
    const signedQuantity = position.assetClass === "FUTURE" ? quantity : Math.abs(quantity);
    const markIsValid = instrument && instrument.assetClass === position.assetClass &&
      instrument.simulated === true && instrument.stale === false &&
      Number.isSafeInteger(instrument.lastPricePaise) && instrument.lastPricePaise > 0 &&
      Number.isFinite(Date.parse(instrument.timestamp)) && Date.parse(instrument.timestamp) <= referenceTime &&
      referenceTime - Date.parse(instrument.timestamp) <= 86400000;
    const markPricePaise = markIsValid ? instrument.lastPricePaise : null;
    const unrealized = markPricePaise === null ? null :
      (markPricePaise - averagePricePaise) * signedQuantity;
    if (unrealized !== null && !Number.isSafeInteger(unrealized)) throw new TypeError("DEMO_PNL_OUT_OF_RANGE");
    if (unrealized === null) valuationComplete = false;
    else unrealizedPnlPaise += unrealized;
    if (!Number.isSafeInteger(unrealizedPnlPaise)) {
      throw new TypeError("DEMO_PORTFOLIO_TOTAL_OUT_OF_RANGE");
    }
    return Object.freeze({
      ...position,
      symbol: instrument?.symbol || position.instrumentKey,
      exchange: instrument?.exchange || "—",
      markPricePaise,
      unrealizedPnlPaise: unrealized,
      costBasisPaise: position.costBasisPaise
    });
  });
  const totalPnlPaise = realizedPnlPaise + unrealizedPnlPaise;
  if (valuationComplete && !Number.isSafeInteger(totalPnlPaise)) throw new TypeError("DEMO_PORTFOLIO_TOTAL_OUT_OF_RANGE");
  const holdings = positions.filter(position =>
    position.assetClass === "EQUITY" && position.product === "DELIVERY" && position.quantity > 0
  );
  return Object.freeze({
    mode: "DEMO", simulationOnly: true, asOf,
    positions: Object.freeze(positions),
    holdings: Object.freeze(holdings),
    orders: snapshot.orders, trades: snapshot.trades,
    realizedPnlPaise,
    unrealizedPnlPaise: valuationComplete ? unrealizedPnlPaise : null,
    totalPnlPaise: valuationComplete ? totalPnlPaise : null,
    valuationComplete,
    ledgerReconciled: false,
    reconciliationStatus: "not_reconciled"
  });
}

async function loadFixtures() {
  const names = ["market", "account", "equity", "derivatives"];
  const fixtures = await Promise.all(names.map(async name => {
    const url = new URL("../../market-gateway/mock/fixtures/" + name + ".json", import.meta.url);
    const response = await fetch(url, { method: "GET", credentials: "omit", cache: "no-store",
      headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("FIXTURE_LOAD_FAILED:" + name);
    return response.json();
  }));
  return createPaperDemoViewModel(Object.fromEntries(names.map((name, index) => [name, fixtures[index]])),
    { enabled: true, production: false });
}

const money = paise => paise === null ? "Unavailable" :
  "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const node = (tag, cls, value) => {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (value !== undefined) element.textContent = String(value);
  return element;
};
function table(headers, rows) {
  const wrap = node("div", "table-wrap"), tableNode = node("table"), head = node("thead"), headerRow = node("tr"), body = node("tbody");
  headers.forEach(value => headerRow.append(node("th", "", value)));
  head.append(headerRow);
  rows.forEach(values => {
    const row = node("tr");
    values.forEach(value => row.append(node("td", "", value ?? "—")));
    body.append(row);
  });
  if (!rows.length) {
    const row = node("tr"), cell = node("td", "empty", "No open DEMO positions.");
    cell.colSpan = headers.length; row.append(cell); body.append(row);
  }
  tableNode.append(head, body); wrap.append(tableNode); return wrap;
}
function renderPortfolio(host, screen, view) {
  const positions = screen === "holdings" ? view.holdings : view.positions;
  const title = node("h3", "", screen === "holdings" ? "DELIVERY HOLDINGS" : "SHARED DEMO POSITIONS");
  const note = node("div", "notice", "Equity, Futures and Options are derived from the same append-only Demo event projection. Marks use canonical synthetic fixtures. No live prices, fees or wallet reconciliation are implied.");
  const metrics = node("div", "grid");
  const metricsData = screen === "holdings"
    ? [["Holdings", String(view.holdings.length), "Equity Delivery only"],
       ["Holdings cost", money(view.holdings.reduce((sum, p) => sum + p.costBasisPaise, 0)), "Paise-based cost basis"]]
    : [["Open positions", String(view.positions.length), "Equity + Futures + Options"],
       ["Realized P&L", money(view.realizedPnlPaise), "From canonical fill transitions"],
       ["Unrealized P&L", money(view.unrealizedPnlPaise), view.valuationComplete ? "Fixture marks · not live" : "Incomplete mark coverage"],
       ["Total P&L", money(view.totalPnlPaise), "Realized + unrealized; fees excluded"]];
  metricsData.forEach(([label, value, detail]) => {
    const card = node("article", "card");
    card.append(node("h3", "", label), node("div", "metric", value), node("div", "sub", detail));
    metrics.append(card);
  });
  const rows = positions.map(p => [p.assetClass, p.symbol, p.exchange, p.product,
    p.quantity, money(p.averagePricePaise), money(p.markPricePaise),
    money(p.costBasisPaise), money(p.realizedPnlPaise), money(p.unrealizedPnlPaise)]);
  host.replaceChildren(title, note, metrics, table(
    ["ASSET", "INSTRUMENT", "EXCHANGE", "PRODUCT", "NET QTY", "AVG PRICE", "MOCK MARK",
      "COST BASIS", "REALIZED P&L", "UNREALIZED P&L"], rows));
  host.append(node("div", "notice", "Ledger reconciliation: false · snapshot consistency: unverified. This screen is a Demo portfolio projection, not an authoritative cash/ledger statement."));
}

let viewModelPromise;
let enhancedHost = null;
let enhancedScreen = null;
function enhancePortfolioScreen() {
  const content = document.getElementById("screen-content");
  if (!content) return;
  const heading = content.querySelector(".screen-title h2");
  const screen = heading?.textContent === "Portfolio" ? "portfolio" :
    heading?.textContent === "Positions" ? "positions" :
    heading?.textContent === "Holdings" ? "holdings" : null;
  if (!screen) { enhancedHost = null; enhancedScreen = null; return; }
  const existing = content.querySelector(".demo-unified-history");
  if (!existing || (existing === enhancedHost && screen === enhancedScreen)) return;
  enhancedHost = existing; enhancedScreen = screen;
  viewModelPromise ||= loadFixtures();
  viewModelPromise.then(model => {
    if (!content.contains(existing) || enhancedHost !== existing || enhancedScreen !== screen) return;
    const view = buildDemoPortfolioView(getDemoProjectionSnapshot(), model.market.instruments, model.asOf);
    renderPortfolio(existing, screen, view);
  }).catch(error => {
    if (enhancedHost === existing) { enhancedHost = null; enhancedScreen = null; }
    existing.replaceChildren(node("div", "notice", "Portfolio valuation unavailable: " + (error.message || "fixture validation failed")));
  });
}
if (typeof document !== "undefined") {
  const content = document.getElementById("screen-content");
  if (content) new MutationObserver(enhancePortfolioScreen).observe(content, { childList: true, subtree: true });
}
