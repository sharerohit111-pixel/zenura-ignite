"use strict";

(function(){
const OPEN = new Set(["PENDING", "PARTIALLY_FILLED"]);
const TERMINAL = new Set(["FILLED", "CANCELLED", "REJECTED", "EXPIRED"]);
const ASSETS = new Set(["EQUITY", "FUTURE", "OPTION"]);
const SIDES = new Set(["BUY", "SELL"]);
const clone = value => JSON.parse(JSON.stringify(value));
const fail = code => { throw Object.assign(new Error(code), { code }); };
const safe = n => Number.isSafeInteger(n) && n >= 0;
const keyOf = (assetClass, product, instrumentKey) => [assetClass, product, instrumentKey].join("|");
const stable = value => {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k)+":"+stable(value[k])).join(",") + "}";
  return JSON.stringify(value);
};

function createDemoTradeHistoryStore(options = {}) {
  if (options.production === true || options.env?.NODE_ENV === "production") fail("DEMO_HISTORY_DISABLED_IN_PRODUCTION");
  const orders = new Map(), submissions = new Map(), fills = new Map(), events = [];
  function submit(input) {
    if (!input || !ASSETS.has(input.assetClass) || !SIDES.has(input.side) ||
        !["MARKET", "LIMIT"].includes(input.orderType) || !["DELIVERY", "INTRADAY"].includes(input.product) ||
        typeof input.instrumentKey !== "string" || !input.instrumentKey.startsWith("MOCK|") ||
        !Number.isSafeInteger(input.quantity) || input.quantity < 1 ||
        typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(input.idempotencyKey) ||
        typeof input.createdAt !== "string" || !Number.isFinite(Date.parse(input.createdAt))) fail("INVALID_DEMO_ORDER");
    if (input.orderType === "LIMIT" && (!safe(input.limitPricePaise) || input.limitPricePaise < 1)) fail("INVALID_DEMO_LIMIT_PRICE");
    const request = {assetClass:input.assetClass,side:input.side,orderType:input.orderType,product:input.product,
      instrumentKey:input.instrumentKey,quantity:input.quantity,limitPricePaise:input.limitPricePaise ?? null};
    const fingerprint = stable(request), prior = submissions.get(input.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail("DEMO_IDEMPOTENCY_KEY_REUSED");
      return clone(orders.get(prior.orderId));
    }
    const orderId = input.orderId || "DEMO-" + input.assetClass + "-" + input.idempotencyKey;
    if (orders.has(orderId)) fail("DEMO_ORDER_ID_COLLISION");
    const order = {...request,orderId,idempotencyKey:input.idempotencyKey,status:"PENDING",
      filledQuantity:0,remainingQuantity:input.quantity,grossValuePaise:0,averagePricePaise:0,
      createdAt:input.createdAt,updatedAt:input.createdAt,simulationOnly:true,source:"SYNTHETIC_FIXTURE"};
    orders.set(orderId,order); submissions.set(input.idempotencyKey,{fingerprint,orderId});
    events.push({type:"ORDER_ACCEPTED",order:clone(order)});
    return clone(order);
  }
  function recordFill(input) {
    const order = orders.get(input?.orderId);
    if (!order) fail("DEMO_ORDER_NOT_FOUND");
    if (typeof input.fillId !== "string" || !input.fillId ||
        !Number.isSafeInteger(input.quantity) || input.quantity < 1 ||
        !safe(input.pricePaise) || input.pricePaise < 1 ||
        typeof input.filledAt !== "string" || !Number.isFinite(Date.parse(input.filledAt))) fail("INVALID_DEMO_FILL");
    const receipt = {fillId:input.fillId,orderId:order.orderId,assetClass:order.assetClass,product:order.product,
      instrumentKey:order.instrumentKey,side:order.side,quantity:input.quantity,pricePaise:input.pricePaise,
      grossValuePaise:input.quantity*input.pricePaise,filledAt:input.filledAt,
      simulationOnly:true,source:"SYNTHETIC_FIXTURE"};
    if (!safe(receipt.grossValuePaise)) fail("DEMO_FILL_AMOUNT_OUT_OF_RANGE");
    const prior = fills.get(receipt.fillId);
    if (prior) {
      if (stable(prior) !== stable(receipt)) fail("DEMO_FILL_ID_REUSED");
      return {duplicate:true,order:clone(order),trade:clone(prior)};
    }
    if (!OPEN.has(order.status) || input.quantity > order.remainingQuantity) fail("DEMO_FILL_EXCEEDS_REMAINING");
    if (order.side === "SELL" && order.assetClass !== "FUTURE") {
      const positionKey = keyOf(order.assetClass,order.product,order.instrumentKey);
      let held = 0;
      for (const priorFill of fills.values()) if (keyOf(priorFill.assetClass,priorFill.product,priorFill.instrumentKey) === positionKey) {
        held += priorFill.side === "BUY" ? priorFill.quantity : -priorFill.quantity;
      }
      if (input.quantity > held) fail("DEMO_POSITION_SELL_EXCEEDS_LONG");
    }
    const nextFilled = order.filledQuantity + input.quantity, nextGross = order.grossValuePaise + receipt.grossValuePaise;
    if (!safe(nextFilled) || !safe(nextGross)) fail("DEMO_FILL_TOTAL_OUT_OF_RANGE");
    order.filledQuantity = nextFilled; order.remainingQuantity -= input.quantity; order.grossValuePaise = nextGross;
    order.averagePricePaise = Math.round(nextGross / nextFilled);
    order.status = order.remainingQuantity === 0 ? "FILLED" : "PARTIALLY_FILLED";
    order.updatedAt = input.filledAt;
    fills.set(receipt.fillId,receipt); events.push({type:"FILL_RECORDED",trade:clone(receipt)});
    return {duplicate:false,order:clone(order),trade:clone(receipt)};
  }
  function reject(orderId, reason, rejectedAt) {
    const order = orders.get(orderId);
    if (!order) fail("DEMO_ORDER_NOT_FOUND");
    if (typeof reason !== "string" || !reason || reason.length > 240 ||
        typeof rejectedAt !== "string" || !Number.isFinite(Date.parse(rejectedAt))) fail("INVALID_DEMO_REJECTION");
    if (order.status === "REJECTED") return {rejected:true,duplicate:true,order:clone(order)};
    if (order.filledQuantity > 0 || order.status === "FILLED" || TERMINAL.has(order.status)) fail("DEMO_ORDER_ALREADY_TERMINAL");
    order.status = "REJECTED"; order.rejectionReason = reason; order.updatedAt = rejectedAt;
    events.push({type:"ORDER_REJECTED",orderId,reason,rejectedAt});
    return {rejected:true,duplicate:false,order:clone(order)};
  }
  function cancel(orderId, cancelledAt) {
    const order = orders.get(orderId);
    if (!order) fail("DEMO_ORDER_NOT_FOUND");
    if (typeof cancelledAt !== "string" || !Number.isFinite(Date.parse(cancelledAt))) fail("INVALID_DEMO_CANCEL_TIME");
    if (order.status === "CANCELLED") return {cancelled:true,duplicate:true,order:clone(order)};
    if (order.status === "FILLED" || TERMINAL.has(order.status)) return {cancelled:false,order:clone(order)};
    order.status = "CANCELLED"; order.updatedAt = cancelledAt;
    events.push({type:"ORDER_CANCELLED",orderId,cancelledAt,filledQuantity:order.filledQuantity,remainingQuantity:order.remainingQuantity});
    return {cancelled:true,duplicate:false,order:clone(order)};
  }
  function snapshot() {
    const orderList = [...orders.values()].map(clone).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.orderId.localeCompare(b.orderId));
    const tradeList = [...fills.values()].map(clone).sort((a,b)=>Date.parse(a.filledAt)-Date.parse(b.filledAt)||a.fillId.localeCompare(b.fillId));
    const positions = new Map();
    for (const trade of tradeList) {
      const key = keyOf(trade.assetClass,trade.product,trade.instrumentKey);
      const p = positions.get(key) || {assetClass:trade.assetClass,product:trade.product,instrumentKey:trade.instrumentKey,
        quantity:0,costBasisPaise:0,averagePricePaise:0,realizedPnlPaise:0};
      if (trade.assetClass === "FUTURE") {
        const signed = trade.side === "BUY" ? trade.quantity : -trade.quantity;
        const old = p.quantity, next = old + signed;
        if (old === 0 || Math.sign(old) === Math.sign(signed)) {
          const total = Math.abs(old)*p.averagePricePaise + trade.quantity*trade.pricePaise;
          p.averagePricePaise = Math.round(total/Math.abs(next));
        } else {
          const closed = Math.min(Math.abs(old),trade.quantity);
          p.realizedPnlPaise += (old > 0 ? trade.pricePaise-p.averagePricePaise : p.averagePricePaise-trade.pricePaise)*closed;
          if (next === 0) p.averagePricePaise = 0;
          else if (Math.sign(next) !== Math.sign(old)) p.averagePricePaise = trade.pricePaise;
        }
        p.quantity = next;
        p.costBasisPaise = Math.abs(next)*p.averagePricePaise;
      } else if (trade.side === "BUY") {
        p.quantity += trade.quantity; p.costBasisPaise += trade.grossValuePaise;
      } else {
        if (trade.quantity > p.quantity) fail("DEMO_POSITION_SELL_EXCEEDS_LONG");
        const allocated = trade.quantity === p.quantity ? p.costBasisPaise : Math.round(p.costBasisPaise * trade.quantity / p.quantity);
        p.quantity -= trade.quantity; p.costBasisPaise -= allocated;
        p.realizedPnlPaise += trade.grossValuePaise - allocated;
      }
      if (trade.assetClass !== "FUTURE") p.averagePricePaise = p.quantity ? Math.round(p.costBasisPaise / p.quantity) : 0;
      positions.set(key,p);
    }
    return clone({mode:"DEMO",provider:"DUMMY_JSON",simulationOnly:true,orders:orderList,
      openOrders:orderList.filter(o=>OPEN.has(o.status)),trades:tradeList,positions:[...positions.values()],events});
  }
  function replay(log) {
    if (!Array.isArray(log)) fail("INVALID_DEMO_EVENT_LOG");
    const replayed = createDemoTradeHistoryStore(options);
    for (const event of log) {
      if (event.type === "ORDER_ACCEPTED") replayed.submit({...event.order,createdAt:event.order.createdAt});
      else if (event.type === "ORDER_REJECTED") replayed.reject(event.orderId,event.reason,event.rejectedAt);
      else if (event.type === "FILL_RECORDED") replayed.recordFill({...event.trade});
      else if (event.type === "ORDER_CANCELLED") replayed.cancel(event.orderId,event.cancelledAt);
      else fail("UNKNOWN_DEMO_EVENT");
    }
    return replayed.snapshot();
  }
  return Object.freeze({submit,recordFill,reject,cancel,snapshot,replay,exportEvents:()=>clone(events)});
}
const api = {createDemoTradeHistoryStore};
if (typeof module === "object" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.ZenuraDemoTradeHistory = api;

})();
