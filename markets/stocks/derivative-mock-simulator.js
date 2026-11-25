(function(root, factory) {
  "use strict";
  const positionApi = typeof module === "object" && module.exports
    ? require("../../market-gateway/lib/derivative-position")
    : root.ZENURA_DERIVATIVE_POSITION;
  const api = factory(positionApi);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZENURA_DERIVATIVE_MOCK = api;
})(typeof window !== "undefined" ? window : globalThis, function(positionApi) {
  "use strict";
  const applyDerivativeFill = positionApi && positionApi.applyDerivativeFill;
  if (typeof applyDerivativeFill !== "function") throw new Error("DERIVATIVE_POSITION_HELPER_REQUIRED");
  const OPEN = new Set(["PENDING", "PARTIALLY_FILLED"]);
  const TYPES = new Set(["BUY", "SELL"]);
  const ORDER_TYPES = new Set(["MARKET", "LIMIT"]);
  const MAX_QUOTE_AGE_MS = 15_000;

  function fail(message) { throw Object.assign(new Error(message), { status: 422 }); }
  function integer(value, label, min) {
    if (!Number.isSafeInteger(value) || value < (min === undefined ? 0 : min)) fail(label + " is invalid.");
    return value;
  }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function expiryCutoff(expiry) {
    if (typeof expiry !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return NaN;
    const parts = expiry.split("-").map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 10, 0, 0, 0));
    return date.toISOString().slice(0, 10) === expiry ? date.getTime() : NaN;
  }
  function validateContractIdentity(contract) {
    const parts = contract.instrumentKey.split("|");
    if (contract.assetClass === "FUTURE") {
      if (parts.length !== 5 || parts[0] !== "MOCK" || parts[1] !== contract.exchange ||
          parts[2] !== "FUT" || parts[3] !== contract.underlying || parts[4] !== contract.expiry ||
          typeof contract.underlying !== "string" || !/^MOCK[A-Z0-9-]*$/.test(contract.underlying)) {
        fail("Futures contract identity does not match its instrument key.");
      }
      return;
    }
    if (parts.length !== 7 || parts[0] !== "MOCK" || parts[1] !== contract.exchange ||
        parts[2] !== "OPT" || parts[3] !== contract.underlying ||
        !Number.isSafeInteger(contract.strikePaise) || contract.strikePaise % 100 !== 0 ||
        parts[4] !== String(contract.strikePaise / 100) || parts[5] !== contract.optionType ||
        parts[6] !== contract.expiry) {
      fail("Options contract identity does not match its underlying, expiry, strike and CE/PE key.");
    }
  }

  function validateEnvelope(envelope) {
    if (!envelope || envelope.schemaVersion !== "1.0.0" || envelope.mode !== "MOCK" ||
        envelope.simulated !== true || envelope.meta?.source !== "SYNTHETIC_FIXTURE" ||
        typeof envelope.asOf !== "string" || !Number.isFinite(Date.parse(envelope.asOf)) ||
        !envelope.data || !Array.isArray(envelope.data.contracts) ||
        !Array.isArray(envelope.data.quotes)) fail("A valid DEMO DATA derivatives fixture is required.");
    return envelope.data;
  }

  function createDerivativeMockSimulator(envelope, options) {
    const data = validateEnvelope(envelope);
    const clock = options && typeof options.now === "function"
      ? options.now
      : () => options && Number.isSafeInteger(options.now) ? options.now : Date.parse(envelope.asOf);
    const maxQuoteAgeMs = options && Number.isSafeInteger(options.maxQuoteAgeMs)
      ? options.maxQuoteAgeMs : MAX_QUOTE_AGE_MS;
    if (maxQuoteAgeMs < 0) fail("Derivative quote freshness limit is invalid.");
    function currentNow() {
      const value = clock();
      if (!Number.isSafeInteger(value) || value < 0) fail("Derivative simulator clock is invalid.");
      return value;
    }
    currentNow();
    const contracts = new Map();
    const quotes = new Map();
    const positions = new Map();
    const orders = [];
    let sequence = 0;

    data.contracts.forEach(contract => {
      if (!contract || typeof contract.instrumentKey !== "string" ||
          !contract.instrumentKey.startsWith("MOCK|") ||
          !["FUTURE", "OPTION"].includes(contract.assetClass) ||
          !["NSE", "BSE"].includes(contract.exchange) ||
          typeof contract.symbol !== "string" || !contract.symbol.startsWith("MOCK") ||
          !Number.isSafeInteger(contract.lotSize) || contract.lotSize < 1 ||
          !Number.isSafeInteger(contract.tickSizePaise) || contract.tickSizePaise < 1 ||
          !Number.isFinite(expiryCutoff(contract.expiry)) || contracts.has(contract.instrumentKey)) {
        fail("Fixture contains an invalid or non-synthetic derivative contract.");
      }
      if (contract.assetClass === "OPTION" &&
          (!["CE", "PE"].includes(contract.optionType) ||
           !Number.isSafeInteger(contract.strikePaise) || contract.strikePaise < 1 ||
           typeof contract.underlying !== "string" || !/^MOCK[A-Z0-9-]*$/.test(contract.underlying))) {
        fail("Fixture contains an invalid CE/PE strike contract.");
      }
      if (contract.assetClass === "FUTURE" && contract.optionType != null) {
        fail("A Futures fixture must not contain an option type.");
      }
      validateContractIdentity(contract);
      contracts.set(contract.instrumentKey, copy(contract));
    });

    data.quotes.forEach(quote => {
      const contract = contracts.get(quote && quote.instrumentKey);
      const timestamp = Date.parse(quote && quote.timestamp);
      if (!contract || quote.provider !== "MOCK" || quote.stale !== false ||
          !Number.isSafeInteger(timestamp) || timestamp > currentNow() || currentNow() - timestamp > maxQuoteAgeMs ||
          !Number.isSafeInteger(quote.bidPricePaise) || quote.bidPricePaise < 1 ||
          !Number.isSafeInteger(quote.askPricePaise) || quote.askPricePaise < quote.bidPricePaise ||
          quote.bidPricePaise % contract.tickSizePaise !== 0 ||
          quote.askPricePaise % contract.tickSizePaise !== 0 ||
          !Number.isSafeInteger(quote.bidQuantity) || quote.bidQuantity < 0 ||
          !Number.isSafeInteger(quote.askQuantity) || quote.askQuantity < 0 ||
          quotes.has(quote.instrumentKey)) {
        fail("Fixture contains an invalid deterministic derivative quote.");
      }
      quotes.set(quote.instrumentKey, {
        base: copy(quote),
        bidRemaining: quote.bidQuantity,
        askRemaining: quote.askQuantity
      });
    });

    function getContract(key) {
      const contract = contracts.get(key);
      if (!contract) fail("Select a contract from the synthetic fixture.");
      if (currentNow() >= expiryCutoff(contract.expiry)) fail("Expired demo contracts cannot be traded.");
      return contract;
    }
    function quoteFor(key) {
      const quote = quotes.get(key);
      if (!quote) fail("A deterministic DEMO DATA quote is unavailable for this contract.");
      const age = currentNow() - Date.parse(quote.base.timestamp);
      if (quote.base.stale !== false || age < 0 || age > maxQuoteAgeMs) {
        fail("A stale or future-dated derivative quote cannot be used for execution or valuation.");
      }
      return quote;
    }
    function positionKey(key, product) { return key + "|PRODUCT|" + (product || "DELIVERY"); }
    function positionFor(key, product) {
      return positions.get(positionKey(key, product)) || { netQuantity: 0, averagePricePaise: 0 };
    }
    function reservedOptionSellQuantity(key) {
      return orders.filter(order => order.instrumentKey === key && order.assetClass === "OPTION" &&
        order.side === "SELL" && OPEN.has(order.status))
        .reduce((sum, order) => sum + order.remainingQuantity, 0);
    }
    function availableOptionQuantity(key) {
      return Math.max(0, positionFor(key, "DELIVERY").netQuantity - reservedOptionSellQuantity(key));
    }
    function updatePosition(order, quantity, pricePaise) {
      const contract = contracts.get(order.instrumentKey);
      const instrumentType = contract.assetClass === "FUTURE" ? "FUT" : contract.optionType;
      const current = positionFor(order.instrumentKey, order.product);
      if (contract.assetClass === "OPTION" && order.side === "SELL" &&
          (current.netQuantity <= 0 || quantity > current.netQuantity)) {
        fail("Options SELL is close-only and cannot open or reverse a short position.");
      }
      const result = applyDerivativeFill({
        instrumentType,
        side: order.side,
        quantity,
        pricePaise,
        position: current,
        now: currentNow()
      });
      if (contract.assetClass === "OPTION" && result.netQuantity < 0) {
        fail("Short CE/PE positions are disabled in this demo.");
      }
      positions.set(positionKey(order.instrumentKey, order.product), {
        netQuantity: result.netQuantity,
        averagePricePaise: result.averagePricePaise
      });
      return result;
    }
    function appendFill(order, quantity, pricePaise) {
      const positionResult = updatePosition(order, quantity, pricePaise);
      const grossPaise = quantity * pricePaise;
      if (!Number.isSafeInteger(grossPaise)) fail("Demo fill value exceeds safe integer limits.");
      order.fills.push({
        fillId: order.orderId + "-F" + String(order.fills.length + 1).padStart(3, "0"),
        quantity,
        pricePaise,
        grossPaise,
        realizedPnlPaise: positionResult.realizedPnlPaise,
        executedAt: new Date(currentNow()).toISOString(),
        simulated: true
      });
      order.filledQuantity += quantity;
      order.remainingQuantity -= quantity;
      order.fillValuePaise += grossPaise;
      order.averageFillPricePaise = Math.round(order.fillValuePaise / order.filledQuantity);
      order.status = order.remainingQuantity === 0 ? "FILLED" : "PARTIALLY_FILLED";
      order.updatedAt = new Date(currentNow()).toISOString();
    }
    function consumeDepth(quote, side, quantity) {
      if (side === "BUY") quote.askRemaining -= quantity;
      else quote.bidRemaining -= quantity;
    }

    function submit(request) {
      if (!request || !TYPES.has(request.side) || !ORDER_TYPES.has(request.orderType)) {
        fail("Choose BUY/SELL and MARKET/LIMIT.");
      }
      const contract = getContract(request.instrumentKey);
      const quote = quoteFor(request.instrumentKey);
      const lots = integer(request.lots, "Lots", 1);
      if (lots > 10000) fail("Lots exceed the demo limit.");
      const quantity = lots * contract.lotSize;
      if (!Number.isSafeInteger(quantity) || quantity > 1000000) fail("Contract quantity is invalid.");
      if (contract.assetClass === "OPTION" && request.side === "SELL" &&
          quantity > availableOptionQuantity(contract.instrumentKey)) {
        fail("Options SELL can only close unreserved long CE/PE quantity.");
      }
      let limitPricePaise = null;
      if (request.orderType === "LIMIT") {
        limitPricePaise = integer(request.limitPricePaise, "Limit price", 1);
        if (limitPricePaise % contract.tickSizePaise !== 0) fail("Limit price does not match the contract tick size.");
      }
      if (contract.assetClass === "FUTURE" &&
          !["INTRADAY", "DELIVERY"].includes(request.product || "DELIVERY")) {
        fail("Choose an Intraday or Delivery Futures product.");
      }
      sequence += 1;
      const order = {
        orderId: "MOCK-FO-" + String(sequence).padStart(6, "0"),
        instrumentKey: contract.instrumentKey,
        symbol: contract.symbol,
        assetClass: contract.assetClass,
        optionType: contract.optionType || null,
        strikePaise: contract.strikePaise || null,
        expiry: contract.expiry,
        side: request.side,
        orderType: request.orderType,
        product: contract.assetClass === "FUTURE" ? (request.product || "DELIVERY") : "DELIVERY",
        lots,
        lotSize: contract.lotSize,
        quantity,
        filledQuantity: 0,
        remainingQuantity: quantity,
        limitPricePaise,
        averageFillPricePaise: null,
        fillValuePaise: 0,
        fills: [],
        status: request.orderType === "LIMIT" ? "PENDING" : "REJECTED",
        rejectionReason: null,
        createdAt: new Date(currentNow()).toISOString(),
        updatedAt: new Date(currentNow()).toISOString(),
        simulationOnly: true
      };
      orders.unshift(order);
      if (request.orderType === "MARKET") {
        const executionPrice = request.side === "BUY" ? quote.base.askPricePaise : quote.base.bidPricePaise;
        const availableDepth = request.side === "BUY" ? quote.askRemaining : quote.bidRemaining;
        if (availableDepth < quantity) {
          order.rejectionReason = "Insufficient deterministic top-of-book depth; MARKET order rejected in full.";
        } else {
          try {
            appendFill(order, quantity, executionPrice);
            consumeDepth(quote, request.side, quantity);
          } catch (error) {
            // A boundary rejection must not leave a blank rejected receipt or consume quote depth.
            order.rejectionReason = error && error.message ? error.message : "Synthetic execution was rejected.";
          }
        }
      }
      return copy(order);
    }

    function processLimitFills() {
      const summary = { scanned: 0, filled: 0, partial: 0, notEligible: 0 };
      orders.filter(order => OPEN.has(order.status)).reverse().forEach(order => {
        summary.scanned += 1;
        const contract = contracts.get(order.instrumentKey);
        if (currentNow() >= expiryCutoff(contract.expiry)) {
          order.status = "EXPIRED";
          order.updatedAt = new Date(currentNow()).toISOString();
          summary.expired = (summary.expired || 0) + 1;
          return;
        }
        const quote = quoteFor(order.instrumentKey);
        const executionPrice = order.side === "BUY" ? quote.base.askPricePaise : quote.base.bidPricePaise;
        const eligible = order.side === "BUY"
          ? executionPrice <= order.limitPricePaise
          : executionPrice >= order.limitPricePaise;
        if (!eligible) { summary.notEligible += 1; return; }
        const availableDepth = order.side === "BUY" ? quote.askRemaining : quote.bidRemaining;
        const fillQuantity = Math.min(order.remainingQuantity, availableDepth) -
          (Math.min(order.remainingQuantity, availableDepth) % order.lotSize);
        if (fillQuantity < order.lotSize) { summary.notEligible += 1; return; }
        appendFill(order, fillQuantity, executionPrice);
        consumeDepth(quote, order.side, fillQuantity);
        if (order.status === "FILLED") summary.filled += 1;
        else summary.partial += 1;
      });
      return summary;
    }

    function cancel(orderId) {
      const order = orders.find(item => item.orderId === orderId);
      if (!order) fail("Demo order was not found.");
      if (!OPEN.has(order.status)) fail("Only pending or partially filled LIMIT orders can be cancelled.");
      order.status = "CANCELLED";
      order.updatedAt = new Date(currentNow()).toISOString();
      return copy(order);
    }

    function refreshQuoteDepth() {
      quotes.forEach((quote, key) => {
        quoteFor(key);
        quote.bidRemaining = quote.base.bidQuantity;
        quote.askRemaining = quote.base.askQuantity;
      });
      return { refreshed: quotes.size, source: "SYNTHETIC_FIXTURE" };
    }

    function snapshot() {
      const positionRows = [];
      positions.forEach((position, compositeKey) => {
        if (position.netQuantity === 0) return;
        const marker = compositeKey.lastIndexOf("|PRODUCT|");
        const key = compositeKey.slice(0, marker);
        const product = compositeKey.slice(marker + 9);
        const contract = contracts.get(key);
        positionRows.push({
          instrumentKey: key,
          product: contract.assetClass === "FUTURE" ? product : "DELIVERY",
          symbol: contract.symbol,
          assetClass: contract.assetClass,
          optionType: contract.optionType || null,
          strikePaise: contract.strikePaise || null,
          expiry: contract.expiry,
          valuationStatus: currentNow() >= expiryCutoff(contract.expiry) ? "EXPIRED" :
            (() => { const q = quotes.get(key); const age = q ? currentNow() - Date.parse(q.base.timestamp) : Infinity;
              return q && q.base.stale === false && age >= 0 && age <= maxQuoteAgeMs ? "FRESH" : "STALE"; })(),
          netQuantity: position.netQuantity,
          averagePricePaise: position.averagePricePaise,
          reservedCloseQuantity: contract.assetClass === "OPTION" ? reservedOptionSellQuantity(key) : 0,
          availableCloseQuantity: contract.assetClass === "OPTION"
            ? availableOptionQuantity(key) : null
        });
      });
      return {
        mode: "MOCK",
        simulated: true,
        positions: copy(positionRows),
        orders: copy(orders.map(({ fillValuePaise, ...order }) => order)),
        accountingNotice: "DEMO only: no cash ledger, charges, margin reservation, broker or exchange is changed."
      };
    }

    return Object.freeze({
      contracts: () => copy(Array.from(contracts.values())),
      submit,
      cancel,
      processLimitFills,
      refreshQuoteDepth,
      snapshot
    });
  }

  return { createDerivativeMockSimulator, MAX_QUOTE_AGE_MS };
});
