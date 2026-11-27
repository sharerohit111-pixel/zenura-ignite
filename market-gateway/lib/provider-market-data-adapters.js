"use strict";

// Concrete response adapters for provider-neutral S-TRADE market-data contracts.
// Network clients, OAuth secrets, entitlement checks and WebSocket binary decoders
// are injected by the host. This module never creates broker orders or opens a
// socket by itself. Provider policy and the runtime rights gate remain mandatory.

function fail(message, code = "invalid_market_data") {
  throw Object.assign(new Error(message), { status: 409, code });
}
function object(value) { return value && typeof value === "object" && !Array.isArray(value); }
function pricePaise(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const p = Math.round(n * 100);
  return Number.isSafeInteger(p) && p > 0 && Math.abs(n * 100 - p) < 1e-7 ? p : null;
}
function integer(value, min = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(n) && n >= min ? n : null;
}
function timestamp(value) {
  if (typeof value === "number" || (typeof value === "string" && /^\d{1,16}$/.test(value))) {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  if (typeof value !== "string") return null;
  const n = Date.parse(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function istTimestamp(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return timestamp(value);
  const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
  const year=Number(match[3]), month=months[match[2]], day=Number(match[1]), hour=Number(match[4]), minute=Number(match[5]), second=Number(match[6]);
  const calendarCheck=new Date(Date.UTC(year,month,day));
  if (calendarCheck.getUTCFullYear()!==year || calendarCheck.getUTCMonth()!==month || calendarCheck.getUTCDate()!==day || hour>23 || minute>59 || second>59) return null;
  return Date.UTC(year, month, day, hour-5, minute-30, second);
}
function assertDependencies(client, resolveInstrument, now) {
  if (!client || typeof client !== "object" || typeof resolveInstrument !== "function" ||
      typeof now !== "function" ||
      !["getQuote","getCandles","getDepth","getInstrumentMaster","openStream","getHealth"].every(k => typeof client[k] === "function")) {
    throw new TypeError("Provider adapter requires a complete injected client, instrument resolver and clock.");
  }
}
function normalizeDepth(rows, side) {
  if (!Array.isArray(rows)) fail("Provider depth side is missing.");
  const levels = rows.slice(0, 30).map(row => {
    if (!object(row)) return null;
    const p = pricePaise(row.price);
    const q = integer(row.quantity, 1);
    return p && q ? { pricePaise:p, quantity:q } : null;
  });
  if (!levels.length || levels.some(x => !x)) fail("Provider depth contains an invalid price or quantity.");
  for (let i=1;i<levels.length;i++) {
    if (side === "bid" ? levels[i-1].pricePaise <= levels[i].pricePaise :
      levels[i-1].pricePaise >= levels[i].pricePaise) fail("Provider depth levels are not strictly ordered.");
  }
  return levels;
}
function normalizeCandles(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 5000) fail("Provider candle response is empty or too large.");
  return rows.map(row => {
    if (!Array.isArray(row) || row.length < 6) fail("Provider candle row is malformed.");
    const t=timestamp(row[0]), open=pricePaise(row[1]), high=pricePaise(row[2]),
      low=pricePaise(row[3]), close=pricePaise(row[4]), volume=integer(row[5],0);
    if (!t || !open || !high || !low || !close || volume === null ||
        high < Math.max(open,close,low) || low > Math.min(open,close,high)) fail("Provider candle values are invalid.");
    return { timestampMs:t, openPaise:open, highPaise:high, lowPaise:low, closePaise:close, volume };
  });
}
function requireNativeInstrument(native, providerId, expectedExchange) {
  if (!native || typeof native !== "object" || Array.isArray(native)) fail(providerId + " instrument mapping is missing.");
  if (!["NSE", "BSE"].includes(expectedExchange) || !["NSE", "BSE"].includes(native.exchange)) {
    fail(providerId + " instrument mapping is missing or has an unsupported exchange.");
  }
  if (native.exchange !== expectedExchange) {
    fail(providerId + " native instrument exchange does not match the requested exchange.", "instrument_mismatch");
  }
  if (providerId === "upstox" &&
      (typeof native.instrumentKey !== "string" || !native.instrumentKey.trim())) fail("Upstox instrument mapping is missing.");
  if (providerId === "angelone" &&
      (typeof native.symbolToken !== "string" || !native.symbolToken.trim() ||
       typeof native.exchangeSegment !== "string" || !native.exchangeSegment.trim())) fail("Angel One instrument mapping is missing.");
  return native;
}
function makeBase(providerId, client, resolveInstrument, now) {
  assertDependencies(client, resolveInstrument, now);
  return {
    providerId,
    async getHealth() {
      const result=await client.getHealth();
      return { healthy: !!(result && result.healthy === true), checkedAtMs:now() };
    },
    async getInstrumentMaster(args) {
      const native=await client.getInstrumentMaster(args);
      const rows=Array.isArray(native) ? native : native?.data;
      if (!Array.isArray(rows) || !rows.length || rows.length > 200000) fail("Provider instrument master is unavailable.");
      const instruments=rows.map(row => {
        const mapped=client.normalizeInstrument ? client.normalizeInstrument(row) : null;
        if (!mapped || typeof mapped.instrumentId !== "string" || !["NSE","BSE"].includes(mapped.exchange)) fail("Provider instrument master mapping is incomplete.");
        return mapped;
      });
      const seen=new Set();
      for (const item of instruments) {
        if (seen.has(item.instrumentId)) fail("Provider instrument master contains duplicate identities.");
        seen.add(item.instrumentId);
      }
      return { providerId, instrumentId:args.instrumentId, exchange:args.exchange,
        entitlementReference:args.entitlementReference, attribution:{displayName:providerId},
        generatedAtMs:now(), sourceReference:providerId+"-instrument-master", instruments };
    },
    async openStream(args) {
      const nativeInstrument=requireNativeInstrument(await resolveInstrument(args),providerId,args.exchange);
      const stream=await client.openStream({ ...args, nativeInstrument });
      if (!stream || typeof stream.close !== "function" ||
          (typeof stream.subscribe !== "function" && typeof stream[Symbol.asyncIterator] !== "function")) {
        fail("Provider stream transport did not return a closable stream.");
      }
      return { providerId, instrumentId:args.instrumentId, exchange:args.exchange,
        entitlementReference:args.entitlementReference, attribution:{displayName:providerId}, stream };
    },
  };
}

function createUpstoxMarketDataAdapter({ client, resolveInstrument, now=()=>Date.now(), maxAgeMs=15000 }) {
  const base=makeBase("upstox",client,resolveInstrument,now);
  async function read(args) {
    const native=requireNativeInstrument(await resolveInstrument(args),"upstox",args.exchange);
    return { native, payload:await client.getQuote({ instrumentKey:native.instrumentKey }) };
  }
  return Object.freeze({
    ...base,
    async getQuote(args) {
      const {native,payload}=await read(args);
      if (!object(payload) || payload.status !== "success" || !object(payload.data)) fail("Upstox quote response is unsuccessful.");
      const entry=Object.values(payload.data).find(x=>x?.instrument_token===native.instrumentKey);
      if (!entry) fail("Upstox quote did not contain the requested instrument.");
      const receivedAtMs=now(), exchangeTimestampMs=timestamp(entry.timestamp),
        lastTradeTimestampMs=timestamp(entry.last_trade_time), lastPricePaise=pricePaise(entry.last_price);
      if (!exchangeTimestampMs || !lastTradeTimestampMs || !lastPricePaise ||
          exchangeTimestampMs > receivedAtMs || receivedAtMs-exchangeTimestampMs > maxAgeMs ||
          lastTradeTimestampMs > receivedAtMs) fail("Upstox quote is stale or has invalid timestamps.", "stale_market_data");
      return { providerId:"upstox", instrumentId:args.instrumentId, exchange:args.exchange,
        lastPricePaise, receivedAtMs, exchangeTimestampMs, lastTradeTimestampMs,
        sourceSequence:[native.instrumentKey,exchangeTimestampMs,lastTradeTimestampMs,lastPricePaise].join(":"),
        entitlementReference:args.entitlementReference, attribution:{displayName:"Upstox"} };
    },
    async getDepth(args) {
      const {native,payload}=await read(args);
      const entry=payload?.data && Object.values(payload.data).find(x=>x?.instrument_token===native.instrumentKey);
      if (!entry?.depth) fail("Upstox depth is unavailable.");
      const bids=normalizeDepth(entry.depth.buy,"bid"), asks=normalizeDepth(entry.depth.sell,"ask");
      if (bids[0].pricePaise >= asks[0].pricePaise) fail("Upstox returned a crossed bid/ask book.");
      const timestampMs=timestamp(entry.timestamp);
      return { providerId:"upstox", instrumentId:args.instrumentId, exchange:args.exchange,
        entitlementReference:args.entitlementReference, attribution:{displayName:"Upstox"},
        timestampMs, sourceSequence:"upstox:"+native.instrumentKey+":"+timestampMs, bids, asks };
    },
    async getCandles(args) {
      const native=requireNativeInstrument(await resolveInstrument(args), "upstox", args.exchange);
      const payload=await client.getCandles({ ...args, instrumentKey:native.instrumentKey });
      if (!payload || payload.status!=="success" || !Array.isArray(payload.data?.candles)) fail("Upstox historical candles response is unsuccessful.");
      return { providerId:"upstox", instrumentId:args.instrumentId, exchange:args.exchange,
        entitlementReference:args.entitlementReference, attribution:{displayName:"Upstox"},
        candles:normalizeCandles(payload.data.candles) };
    },
  });
}

function createAngelOneMarketDataAdapter({ client, resolveInstrument, now=()=>Date.now(), maxAgeMs=15000 }) {
  const base=makeBase("angelone",client,resolveInstrument,now);
  async function read(args, mode="FULL") {
    const native=requireNativeInstrument(await resolveInstrument(args),"angelone",args.exchange);
    const payload=await client.getQuote({ mode, exchangeTokens:{ [native.exchangeSegment]:[native.symbolToken] } });
    if (!payload || payload.status!==true || !Array.isArray(payload.data?.fetched)) fail("Angel One market-data response is unsuccessful.");
    const entry=payload.data.fetched.find(x=>String(x.symbolToken)===native.symbolToken && x.exchange===native.exchange);
    if (!entry) fail("Angel One response did not contain the requested instrument.");
    return { native, entry };
  }
  return Object.freeze({
    ...base,
    async getQuote(args) {
      const {entry}=await read(args,"FULL"), receivedAtMs=now(),
        exchangeTimestampMs=istTimestamp(entry.exchFeedTime), lastTradeTimestampMs=istTimestamp(entry.exchTradeTime),
        lastPricePaise=pricePaise(entry.ltp);
      if (!exchangeTimestampMs || !lastTradeTimestampMs || !lastPricePaise ||
          exchangeTimestampMs>receivedAtMs || receivedAtMs-exchangeTimestampMs>maxAgeMs ||
          lastTradeTimestampMs>receivedAtMs) fail("Angel One quote is stale or has invalid timestamps.","stale_market_data");
      return { providerId:"angelone", instrumentId:args.instrumentId, exchange:args.exchange,
        lastPricePaise, receivedAtMs, exchangeTimestampMs, lastTradeTimestampMs,
        sourceSequence:["angelone",entry.symbolToken,exchangeTimestampMs,lastTradeTimestampMs,lastPricePaise].join(":"),
        entitlementReference:args.entitlementReference, attribution:{displayName:"Angel One SmartAPI"} };
    },
    async getDepth(args) {
      const {entry}=await read(args,"FULL");
      const bids=normalizeDepth(entry.depth?.buy,"bid"), asks=normalizeDepth(entry.depth?.sell,"ask");
      if (bids[0].pricePaise >= asks[0].pricePaise) fail("Angel One returned a crossed bid/ask book.");
      const timestampMs=istTimestamp(entry.exchFeedTime);
      return { providerId:"angelone", instrumentId:args.instrumentId, exchange:args.exchange,
        entitlementReference:args.entitlementReference, attribution:{displayName:"Angel One SmartAPI"},
        timestampMs, sourceSequence:"angelone:"+entry.symbolToken+":"+timestampMs, bids, asks };
    },
    async getCandles(args) {
      const native=requireNativeInstrument(await resolveInstrument(args), "angelone", args.exchange);
      const payload=await client.getCandles({ ...args, exchange:native.exchange, symbolToken:native.symbolToken });
      if (!payload || payload.status!==true || !Array.isArray(payload.data)) fail("Angel One historical candle response is unsuccessful.");
      return { providerId:"angelone", instrumentId:args.instrumentId, exchange:args.exchange,
        entitlementReference:args.entitlementReference, attribution:{displayName:"Angel One SmartAPI"},
        candles:normalizeCandles(payload.data) };
    },
  });
}

module.exports = {
  createUpstoxMarketDataAdapter,
  createAngelOneMarketDataAdapter,
  pricePaise,
  timestamp,
  istTimestamp,
  normalizeDepth,
  normalizeCandles,
};
