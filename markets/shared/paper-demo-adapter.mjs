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
      !SIDES.has(order.side) || !ORDER_TYPES.has(order.orderType) || !ORDER_STATUSES.has(order.status)) {
    fail("INVALID_MOCK_ORDER:" + name);
  }
  if (order.quantity !== undefined && (!Number.isSafeInteger(order.quantity) || order.quantity < 1)) fail("INVALID_MOCK_ORDER_QUANTITY:" + name);
  if (order.lots !== undefined && (!Number.isSafeInteger(order.lots) || order.lots < 1)) fail("INVALID_MOCK_ORDER_LOTS:" + name);
  if (order.quantity === undefined && order.lots === undefined) fail("MOCK_ORDER_SIZE_REQUIRED:" + name);
  for (const field of ["averagePricePaise", "limitPricePaise", "chargesPaise"]) {
    const minimum = field === "limitPricePaise" ? 1 : 0;
    if (order[field] !== undefined && (!Number.isSafeInteger(order[field]) || order[field] < minimum)) fail("INVALID_MOCK_ORDER_MONEY:" + name + ":" + field);
  }
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

  if (!Array.isArray(market.quotes) || market.quotes.length === 0) fail("MOCK_MARKET_QUOTES_REQUIRED");
  for (const quote of market.quotes) {
    if (!isObject(quote) || quote.provider !== "MOCK" || quote.stale !== false ||
        !Number.isSafeInteger(quote.lastPricePaise) || quote.lastPricePaise <= 0 ||
        !Number.isFinite(Date.parse(quote.timestamp))) fail("INVALID_SYNTHETIC_QUOTE");
    assertMockInstrument(quote.instrumentKey, quote.symbol);
  }
  if (!isObject(market.depth) || !Array.isArray(market.depth.bids) || !Array.isArray(market.depth.asks)) fail("INVALID_SYNTHETIC_DEPTH");
  const depthQuote = market.quotes.find(quote => quote.instrumentKey === market.depth.instrumentKey);
  if (!depthQuote) fail("UNKNOWN_SYNTHETIC_DEPTH_INSTRUMENT");
  assertMockInstrument(market.depth.instrumentKey, depthQuote.symbol);
  for (const level of [...market.depth.bids, ...market.depth.asks]) {
    if (!isObject(level) || !Number.isSafeInteger(level.pricePaise) || level.pricePaise <= 0 ||
        !Number.isSafeInteger(level.quantity) || level.quantity < 0) fail("INVALID_SYNTHETIC_DEPTH_LEVEL");
  }

  if (account.currency !== "INR" || account.startingCapitalPaise !== 100000000 ||
      !Number.isSafeInteger(account.cashBalancePaise) || !Number.isSafeInteger(account.blockedFundsPaise) ||
      !Number.isSafeInteger(account.availableFundsPaise) ||
      account.cashBalancePaise < 0 || account.blockedFundsPaise < 0 || account.availableFundsPaise < 0 ||
      !Number.isSafeInteger(account.blockedFundsPaise + account.availableFundsPaise) ||
      account.cashBalancePaise !== account.blockedFundsPaise + account.availableFundsPaise ||
      typeof account.ledgerReconciled !== "boolean") fail("INVALID_MOCK_ACCOUNT_SNAPSHOT");

  assertMockInstrument(equity.instrumentKey, equity.symbol);
  assertOrder(equity.order, "equity");
  if (!isObject(equity.position) || !Number.isSafeInteger(equity.position.quantity) || equity.position.quantity < 0 ||
      !Number.isSafeInteger(equity.position.averagePricePaise) || equity.position.averagePricePaise < 0) fail("INVALID_MOCK_EQUITY_POSITION");

  if (!isObject(derivatives.futures) || !isObject(derivatives.options)) fail("INVALID_MOCK_DERIVATIVES");
  assertMockInstrument(derivatives.futures.instrumentKey, derivatives.futures.symbol);
  assertOrder(derivatives.futures.order, "futures");
  if (!["CE", "PE"].includes(derivatives.options.optionType)) fail("INVALID_MOCK_OPTION_TYPE");
  assertMockInstrument(derivatives.options.instrumentKey, "MOCK" + derivatives.options.optionType);
  assertOrder(derivatives.options.order, "options");

  const instruments = market.quotes.map(quote => {
    const [, exchange, segment] = quote.instrumentKey.split("|");
    if (!["NSE", "BSE"].includes(exchange)) fail("INVALID_MOCK_EXCHANGE");
    return {
      instrumentKey: quote.instrumentKey, symbol: quote.symbol, exchange,
      assetClass: segment === "FUT" ? "FUTURE" : segment === "OPT" ? "OPTION" : "EQUITY",
      lastPricePaise: quote.lastPricePaise,
      changePaise: Number.isSafeInteger(quote.changePaise) ? quote.changePaise : 0,
      volume: Number.isSafeInteger(quote.volume) ? quote.volume : 0,
      timestamp: quote.timestamp, stale: quote.stale, simulated: true
    };
  });
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
    derivatives:Object.freeze({futures:clone(derivatives.futures),options:clone(derivatives.options)})
  });
}
export function isPaperDemoViewModel(value) {
  return isObject(value) && value.meta?.provider === "DUMMY_JSON" &&
    value.meta?.mode === "DEMO" && value.meta?.simulated === true;
}
