const ENVELOPE_VERSION = "1.0.0";
const ORDER_STATUSES = new Set(["PENDING", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED", "EXPIRED"]);
const SIDES = new Set(["BUY", "SELL"]);
const ORDER_TYPES = new Set(["MARKET", "LIMIT"]);

function fail(code) { throw new TypeError(code); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}
function assertEnvelope(value, name) {
  if (!isObject(value) || value.schemaVersion !== ENVELOPE_VERSION ||
      value.mode !== "MOCK" || value.simulated !== true ||
      typeof value.requestId !== "string" || !value.requestId ||
      typeof value.asOf !== "string" || !Number.isFinite(Date.parse(value.asOf)) ||
      !isObject(value.data)) fail("INVALID_MOCK_ENVELOPE:" + name);
  if (!isObject(value.meta) || value.meta.source !== "SYNTHETIC_FIXTURE") fail("INVALID_MOCK_META:" + name);
  return value.data;
}
function assertMockInstrument(instrumentKey, symbol) {
  if (typeof instrumentKey !== "string" || !instrumentKey.startsWith("MOCK|")) fail("NON_SYNTHETIC_INSTRUMENT_KEY");
  if (typeof symbol !== "string" || !/^MOCK[A-Z0-9-]*$/.test(symbol)) fail("NON_SYNTHETIC_INSTRUMENT_SYMBOL");
}
function assertOrder(order, name) {
  if (!isObject(order) || typeof order.orderId !== "string" || !order.orderId ||
      !SIDES.has(order.side) || !ORDER_TYPES.has(order.orderType) || !ORDER_STATUSES.has(order.status)) fail("INVALID_MOCK_ORDER:" + name);
  if (order.quantity !== undefined && (!Number.isSafeInteger(order.quantity) || order.quantity < 1)) fail("INVALID_MOCK_ORDER_QUANTITY:" + name);
  if (order.lots !== undefined && (!Number.isSafeInteger(order.lots) || order.lots < 1)) fail("INVALID_MOCK_ORDER_LOTS:" + name);
  if (order.quantity === undefined && order.lots === undefined) fail("MOCK_ORDER_SIZE_REQUIRED:" + name);
  for (const field of ["averagePricePaise", "limitPricePaise", "chargesPaise"]) {
    const minimum = field === "limitPricePaise" ? 1 : 0;
    if (order[field] !== undefined && (!Number.isSafeInteger(order[field]) || order[field] < minimum)) fail("INVALID_MOCK_ORDER_MONEY:" + name + ":" + field);
  }
}
function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}
function searchScore(item, query) {
  const symbol = String(item.symbol || "").toLowerCase();
  const underlying = String(item.underlying || "").toLowerCase();
  const key = String(item.instrumentKey || "").toLowerCase();
  if (symbol === query) return 0;
  if (symbol.startsWith(query)) return 1;
  if (underlying === query) return 2;
  if (underlying.startsWith(query)) return 3;
  if (symbol.includes(query)) return 4;
  if (underlying.includes(query) || key.includes(query)) return 5;
  return Number.POSITIVE_INFINITY;
}

/** Pure browser-safe adapter. Explicit non-production DEMO opt-in is mandatory. */
export function createPaperDemoViewModel(fixtures, options = {}) {
  if (options.enabled !== true) fail("PAPER_DEMO_NOT_EXPLICITLY_ENABLED");
  if (options.production === true) fail("PAPER_DEMO_DISABLED_IN_PRODUCTION");
  if (!isObject(fixtures)) fail("MOCK_FIXTURES_REQUIRED");

  const market = assertEnvelope(fixtures.market, "market");
  const account = assertEnvelope(fixtures.account, "account");
  const equity = assertEnvelope(fixtures.equity, "equity");
  const derivatives = assertEnvelope(fixtures.derivatives, "derivatives");
  if (![fixtures.account, fixtures.equity, fixtures.derivatives].every(item => item.asOf === fixtures.market.asOf)) {
    fail("MOCK_FIXTURE_SNAPSHOT_MISMATCH");
  }

  if (!Array.isArray(market.quotes) || market.quotes.length === 0) fail("MOCK_MARKET_QUOTES_REQUIRED");
  const instrumentKeys = new Set();
  const instruments = market.quotes.map(quote => {
    if (!isObject(quote) || quote.provider !== "MOCK" || quote.stale !== false ||
        !Number.isSafeInteger(quote.lastPricePaise) || quote.lastPricePaise <= 0 ||
        !Number.isFinite(Date.parse(quote.timestamp))) fail("INVALID_SYNTHETIC_QUOTE");
    assertMockInstrument(quote.instrumentKey, quote.symbol);
    const [, exchange, segment] = quote.instrumentKey.split("|");
    if (!["NSE", "BSE"].includes(exchange) || !["EQ", "INDEX"].includes(segment) || instrumentKeys.has(quote.instrumentKey)) fail("INVALID_OR_DUPLICATE_MOCK_MARKET_INSTRUMENT");
    instrumentKeys.add(quote.instrumentKey);
    return {
      instrumentKey: quote.instrumentKey, symbol: quote.symbol, exchange,
      assetClass: segment === "INDEX" ? "INDEX" : "EQUITY",
      underlying: quote.symbol, expiry: null, optionType: null, strikePaise: null,
      lotSize: null, tickSizePaise: null, lastPricePaise: quote.lastPricePaise,
      changePaise: Number.isSafeInteger(quote.changePaise) ? quote.changePaise : 0,
      volume: Number.isSafeInteger(quote.volume) ? quote.volume : 0,
      bidPricePaise: null, askPricePaise: null, bidQuantity: null, askQuantity: null,
      timestamp: quote.timestamp, stale: false, simulated: true
    };
  });

  if (!isObject(market.depth) || !Array.isArray(market.depth.bids) || !Array.isArray(market.depth.asks)) fail("INVALID_SYNTHETIC_DEPTH");
  const depthQuote = market.quotes.find(quote => quote.instrumentKey === market.depth.instrumentKey);
  if (!depthQuote) fail("UNKNOWN_SYNTHETIC_DEPTH_INSTRUMENT");
  assertMockInstrument(market.depth.instrumentKey, depthQuote.symbol);
  for (const level of [...market.depth.bids, ...market.depth.asks]) {
    if (!isObject(level) || !Number.isSafeInteger(level.pricePaise) || level.pricePaise <= 0 ||
        !Number.isSafeInteger(level.quantity) || level.quantity < 0) fail("INVALID_SYNTHETIC_DEPTH_LEVEL");
  }

  const allowedAccountFields = new Set([
    "accountId", "currency", "startingCapitalPaise", "cashBalancePaise",
    "blockedFundsPaise", "availableFundsPaise", "realizedPnlPaise",
    "unrealizedPnlPaise", "ledgerReconciled"
  ]);
  if (typeof account.accountId !== "string" || !/^mock-[a-z0-9-]+$/.test(account.accountId) ||
      Object.keys(account).some(field => !allowedAccountFields.has(field))) {
    fail("INVALID_MOCK_ACCOUNT_IDENTITY");
  }
  if (account.currency !== "INR" || account.startingCapitalPaise !== 100000000 ||
      !Number.isSafeInteger(account.cashBalancePaise) || !Number.isSafeInteger(account.blockedFundsPaise) ||
      !Number.isSafeInteger(account.availableFundsPaise) ||
      account.cashBalancePaise < 0 || account.blockedFundsPaise < 0 || account.availableFundsPaise < 0 ||
      !Number.isSafeInteger(account.blockedFundsPaise + account.availableFundsPaise) ||
      account.cashBalancePaise !== account.blockedFundsPaise + account.availableFundsPaise ||
      typeof account.ledgerReconciled !== "boolean") fail("INVALID_MOCK_ACCOUNT_SNAPSHOT");

  assertMockInstrument(equity.instrumentKey, equity.symbol);
  const equityQuote = market.quotes.find(quote => quote.instrumentKey === equity.instrumentKey);
  if (!equityQuote || equityQuote.symbol !== equity.symbol) fail("MOCK_EQUITY_INSTRUMENT_MISMATCH");
  assertOrder(equity.order, "equity");
  if (!isObject(equity.position) || !Number.isSafeInteger(equity.position.quantity) || equity.position.quantity < 0 ||
      !Number.isSafeInteger(equity.position.averagePricePaise) || equity.position.averagePricePaise < 0) fail("INVALID_MOCK_EQUITY_POSITION");

  if (!isObject(derivatives.futures) || !isObject(derivatives.options)) fail("INVALID_MOCK_DERIVATIVES");
  assertMockInstrument(derivatives.futures.instrumentKey, derivatives.futures.symbol);
  assertOrder(derivatives.futures.order, "futures");
  if (!["CE", "PE"].includes(derivatives.options.optionType)) fail("INVALID_MOCK_OPTION_TYPE");
  assertMockInstrument(derivatives.options.instrumentKey, derivatives.options.symbol);
  assertOrder(derivatives.options.order, "options");

  if (!Array.isArray(derivatives.contracts) || derivatives.contracts.length === 0 ||
      !Array.isArray(derivatives.quotes) || derivatives.quotes.length !== derivatives.contracts.length) fail("MOCK_DERIVATIVE_CATALOG_REQUIRED");
  const derivativeQuotes = new Map();
  for (const quote of derivatives.quotes) {
    if (!isObject(quote) || quote.provider !== "MOCK" || quote.stale !== false ||
        !Number.isSafeInteger(quote.bidPricePaise) || quote.bidPricePaise <= 0 ||
        !Number.isSafeInteger(quote.askPricePaise) || quote.askPricePaise < quote.bidPricePaise ||
        !Number.isSafeInteger(quote.bidQuantity) || quote.bidQuantity < 0 ||
        !Number.isSafeInteger(quote.askQuantity) || quote.askQuantity < 0 ||
        !Number.isFinite(Date.parse(quote.timestamp)) || derivativeQuotes.has(quote.instrumentKey)) fail("INVALID_MOCK_DERIVATIVE_QUOTE");
    derivativeQuotes.set(quote.instrumentKey, quote);
  }
  for (const contract of derivatives.contracts) {
    if (!isObject(contract) || !["NSE", "BSE"].includes(contract.exchange) ||
        !["FUTURE", "OPTION"].includes(contract.assetClass) || !validDate(contract.expiry) ||
        !Number.isSafeInteger(contract.lotSize) || contract.lotSize < 1 ||
        !Number.isSafeInteger(contract.tickSizePaise) || contract.tickSizePaise < 1) fail("INVALID_MOCK_DERIVATIVE_CONTRACT");
    assertMockInstrument(contract.instrumentKey, contract.symbol);
    if (instrumentKeys.has(contract.instrumentKey)) fail("DUPLICATE_MOCK_INSTRUMENT_KEY");
    instrumentKeys.add(contract.instrumentKey);
    if (typeof contract.underlying !== "string" || !/^MOCK[A-Z0-9-]*$/.test(contract.underlying)) fail("INVALID_MOCK_UNDERLYING");
    if (contract.assetClass === "OPTION" &&
        (!["CE", "PE"].includes(contract.optionType) || !Number.isSafeInteger(contract.strikePaise) || contract.strikePaise < 1)) fail("INVALID_MOCK_OPTION_CONTRACT");
    if (contract.assetClass === "FUTURE" && (contract.optionType !== undefined || contract.strikePaise !== undefined)) fail("INVALID_MOCK_FUTURE_CONTRACT");
    const quote = derivativeQuotes.get(contract.instrumentKey);
    if (!quote) fail("MISSING_MOCK_DERIVATIVE_QUOTE");
    const [, keyExchange] = contract.instrumentKey.split("|");
    if (keyExchange !== contract.exchange) fail("MOCK_CONTRACT_EXCHANGE_MISMATCH");
    instruments.push({
      instrumentKey: contract.instrumentKey, symbol: contract.symbol, exchange: contract.exchange,
      assetClass: contract.assetClass, underlying: contract.underlying, expiry: contract.expiry,
      optionType: contract.optionType || null, strikePaise: contract.strikePaise ?? null,
      lotSize: contract.lotSize, tickSizePaise: contract.tickSizePaise,
      lastPricePaise: Math.round((quote.bidPricePaise + quote.askPricePaise) / 2),
      changePaise: 0, volume: 0, bidPricePaise: quote.bidPricePaise, askPricePaise: quote.askPricePaise,
      bidQuantity: quote.bidQuantity, askQuantity: quote.askQuantity,
      timestamp: quote.timestamp, stale: quote.stale, simulated: true
    });
  }
  if (derivativeQuotes.size !== derivatives.contracts.length) fail("ORPHAN_MOCK_DERIVATIVE_QUOTE");
  const futuresContract = derivatives.contracts.find(item => item.instrumentKey === derivatives.futures.instrumentKey);
  if (!futuresContract || futuresContract.assetClass !== "FUTURE" ||
      futuresContract.symbol !== derivatives.futures.symbol || futuresContract.expiry !== derivatives.futures.expiry ||
      futuresContract.lotSize !== derivatives.futures.lotSize || futuresContract.tickSizePaise !== derivatives.futures.tickSizePaise) {
    fail("MOCK_FUTURES_ORDER_INSTRUMENT_MISMATCH");
  }
  const optionContract = derivatives.contracts.find(item => item.instrumentKey === derivatives.options.instrumentKey);
  if (!optionContract || optionContract.assetClass !== "OPTION" ||
      optionContract.symbol !== derivatives.options.symbol || optionContract.underlying !== derivatives.options.underlying ||
      optionContract.optionType !== derivatives.options.optionType || optionContract.strikePaise !== derivatives.options.strikePaise ||
      optionContract.expiry !== derivatives.options.expiry || optionContract.lotSize !== derivatives.options.lotSize ||
      optionContract.tickSizePaise !== derivatives.options.tickSizePaise) {
    fail("MOCK_OPTIONS_ORDER_INSTRUMENT_MISMATCH");
  }

  const orders = [
    {assetClass:"EQUITY",instrumentKey:equity.instrumentKey,...clone(equity.order)},
    {assetClass:"FUTURE",instrumentKey:derivatives.futures.instrumentKey,...clone(derivatives.futures.order)},
    {assetClass:"OPTION",instrumentKey:derivatives.options.instrumentKey,...clone(derivatives.options.order)}
  ];
  const positions = [{assetClass:"EQUITY",instrumentKey:equity.instrumentKey,...clone(equity.position)}];

  return deepFreeze({
    meta: Object.freeze({provider:"DUMMY_JSON",mode:"DEMO",simulated:true,schemaVersion:ENVELOPE_VERSION,
      disclaimer:"DEMO DATA — synthetic paper-trading fixtures only; not live NSE/BSE data."}),
    asOf: fixtures.market.asOf,
    market: Object.freeze({exchange:market.exchange,marketStatus:market.marketStatus,
      instruments:Object.freeze(instruments),
      depth:Object.freeze({instrumentKey:market.depth.instrumentKey,bids:clone(market.depth.bids),asks:clone(market.depth.asks)})}),
    account:Object.freeze(clone(account)),
    orders:Object.freeze(orders),
    positions:Object.freeze(positions),
    derivatives:Object.freeze({futures:clone(derivatives.futures),options:clone(derivatives.options),contracts:clone(derivatives.contracts),quotes:clone(derivatives.quotes)})
  });
}

export function searchPaperDemoInstruments(model, filters = {}) {
  if (!isPaperDemoViewModel(model)) fail("INVALID_PAPER_DEMO_VIEW_MODEL");
  const query = String(filters.query || "").trim().toLowerCase().slice(0, 60);
  const exchange = String(filters.exchange || "").toUpperCase();
  const assetClass = String(filters.assetClass || "").toUpperCase();
  const underlying = String(filters.underlying || "").toUpperCase();
  const expiry = filters.expiry ? String(filters.expiry) : "";
  const optionType = String(filters.optionType || "").toUpperCase();
  const strikePaise = filters.strikePaise === undefined || filters.strikePaise === "" ? null : Number(filters.strikePaise);
  const allowedClasses = new Set(["EQUITY", "INDEX", "FUTURE", "OPTION"]);
  if (exchange && !["NSE", "BSE"].includes(exchange)) fail("INVALID_DEMO_EXCHANGE_FILTER");
  if (assetClass && !allowedClasses.has(assetClass)) fail("INVALID_DEMO_ASSET_FILTER");
  if (optionType && !["CE", "PE"].includes(optionType)) fail("INVALID_DEMO_OPTION_TYPE_FILTER");
  if (expiry && !validDate(expiry)) fail("INVALID_DEMO_EXPIRY_FILTER");
  if (strikePaise !== null && (!Number.isSafeInteger(strikePaise) || strikePaise < 1)) fail("INVALID_DEMO_STRIKE_FILTER");
  const matches = model.market.instruments.filter(item =>
    (!exchange || item.exchange === exchange) &&
    (!assetClass || item.assetClass === assetClass) &&
    (!underlying || item.underlying === underlying) &&
    (!expiry || item.expiry === expiry) &&
    (!optionType || item.optionType === optionType) &&
    (strikePaise === null || item.strikePaise === strikePaise) &&
    (!query || Number.isFinite(searchScore(item, query)))
  );
  if (!query) return matches.slice();
  return matches.map((item,index)=>({item,index,score:searchScore(item,query)}))
    .sort((a,b)=>a.score-b.score||a.item.symbol.localeCompare(b.item.symbol)||a.item.instrumentKey.localeCompare(b.item.instrumentKey)||a.index-b.index)
    .map(x=>x.item);
}
export function getPaperDemoExpiries(model, {underlying, assetClass = "OPTION", exchange = ""} = {}) {
  if (!isPaperDemoViewModel(model)) fail("INVALID_PAPER_DEMO_VIEW_MODEL");
  const u = String(underlying || "").toUpperCase(), kind = String(assetClass || "").toUpperCase(), ex = String(exchange || "").toUpperCase();
  if (!u || !["OPTION", "FUTURE"].includes(kind) || (ex && !["NSE", "BSE"].includes(ex))) fail("INVALID_DEMO_EXPIRY_QUERY");
  return [...new Set(model.market.instruments.filter(item => item.underlying === u && item.assetClass === kind && (!ex || item.exchange === ex)).map(item => item.expiry).filter(Boolean))].sort();
}
export function getPaperDemoOptionChain(model, {underlying, expiry, strikePaise, optionType, exchange = ""} = {}) {
  if (!isPaperDemoViewModel(model)) fail("INVALID_PAPER_DEMO_VIEW_MODEL");
  const u = String(underlying || "").toUpperCase(), ex = String(exchange || "").toUpperCase();
  if (!u || !validDate(expiry) || (ex && !["NSE", "BSE"].includes(ex)) || (optionType && !["CE", "PE"].includes(optionType))) fail("INVALID_DEMO_OPTION_CHAIN_QUERY");
  const rows = model.market.instruments.filter(item => item.assetClass === "OPTION" && item.underlying === u &&
    item.expiry === expiry && (!ex || item.exchange === ex) && (!optionType || item.optionType === optionType) &&
    (strikePaise === undefined || item.strikePaise === Number(strikePaise)));
  const strikes = [...new Set(rows.map(item => item.strikePaise))].sort((a,b)=>a-b);
  return strikes.map(strike => ({
    strikePaise: strike,
    CE: rows.find(item => item.strikePaise === strike && item.optionType === "CE") || null,
    PE: rows.find(item => item.strikePaise === strike && item.optionType === "PE") || null
  }));
}
export function isPaperDemoViewModel(value) {
  return isObject(value) && value.meta?.provider === "DUMMY_JSON" &&
    value.meta?.mode === "DEMO" && value.meta?.simulated === true;
}
