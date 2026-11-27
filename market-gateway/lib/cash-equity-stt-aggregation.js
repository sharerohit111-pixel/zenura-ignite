"use strict";

const { roundPaiseToNearestRupee } = require("./statutory-rounding");

// NSE Cash Market STT rates effective 2026-04-01.
// Delivery purchase and sale: 0.10% each.
// Sale other than delivery: 0.025%.
const RATE_VERSION = "2026-04-01";
const VERIFIED_THROUGH = "2026-11-27";
const DELIVERY_RATE = Object.freeze({ numerator: 10, denominator: 10_000 });
const NON_DELIVERY_SELL_RATE = Object.freeze({ numerator: 25, denominator: 100_000 });

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(label + " is required.");
  }
  return value.trim();
}

function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function safeInteger(value, label, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new TypeError(label + " must be a safe integer >= " + min + ".");
  }
}

function roundRatioHalfUp(numerator, denominator) {
  const q = numerator / denominator;
  const r = numerator % denominator;
  const rounded = q + (r * 2n >= denominator ? 1n : 0n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Cash STT amount exceeds supported safe integer range.");
  }
  return Number(rounded);
}

function roundSttToPaise(taxableValuePaise, rate) {
  return roundRatioHalfUp(
    BigInt(taxableValuePaise) * BigInt(rate.numerator),
    BigInt(rate.denominator)
  );
}

function aggregateCashEquityStt(trades) {
  if (!Array.isArray(trades)) throw new TypeError("trades must be an array.");
  if (trades.length === 0) return Object.freeze({ groups: [], clients: [] });

  const groups = new Map();
  const ids = new Set();

  for (const trade of trades) {
    if (!trade || typeof trade !== "object" || Array.isArray(trade)) {
      throw new TypeError("Each cash trade must be an object.");
    }
    const tradeId = text(trade.tradeId, "tradeId");
    if (ids.has(tradeId)) throw new TypeError("Duplicate tradeId in cash STT batch.");
    ids.add(tradeId);

    const clientId = text(trade.clientId, "clientId");
    const securityId = text(trade.securityId, "securityId").toUpperCase();
    const settlementId = text(trade.settlementId, "settlementId");
    const tradeDate = text(trade.tradeDate, "tradeDate");
    if (!date(tradeDate)) throw new TypeError("tradeDate must be a valid YYYY-MM-DD date.");
    if (tradeDate < RATE_VERSION || tradeDate > VERIFIED_THROUGH) {
      throw new RangeError("No verified cash STT schedule for this trade date.");
    }

    const settlementType = text(trade.settlementType, "settlementType").toUpperCase();
    if (!["NETTED", "NON_NETTED"].includes(settlementType)) {
      throw new TypeError("settlementType must be NETTED or NON_NETTED.");
    }
    const side = text(trade.side, "side").toUpperCase();
    if (!["BUY", "SELL"].includes(side)) throw new TypeError("side must be BUY or SELL.");
    safeInteger(trade.quantity, "quantity", 1);
    safeInteger(trade.tradeValuePaise, "tradeValuePaise", 1);

    const key = JSON.stringify([clientId, securityId, settlementId, tradeDate, settlementType]);
    if (!groups.has(key)) {
      groups.set(key, {
        clientId, securityId, settlementId, tradeDate, settlementType,
        buyQty: 0n, sellQty: 0n, buyValuePaise: 0n, sellValuePaise: 0n, tradeCount: 0
      });
    }
    const group = groups.get(key);
    if (side === "BUY") {
      group.buyQty += BigInt(trade.quantity);
      group.buyValuePaise += BigInt(trade.tradeValuePaise);
    } else {
      group.sellQty += BigInt(trade.quantity);
      group.sellValuePaise += BigInt(trade.tradeValuePaise);
    }
    group.tradeCount += 1;
  }

  const outputGroups = [];
  const clientTotals = new Map();

  for (const g of groups.values()) {
    for (const [name, value] of [
      ["buyQty", g.buyQty], ["sellQty", g.sellQty],
      ["buyValuePaise", g.buyValuePaise], ["sellValuePaise", g.sellValuePaise]
    ]) {
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RangeError(name + " exceeds supported safe integer range.");
      }
    }

    const buyQty = Number(g.buyQty);
    const sellQty = Number(g.sellQty);
    const buyValuePaise = Number(g.buyValuePaise);
    const sellValuePaise = Number(g.sellValuePaise);
    let deliveryBuyQty;
    let deliverySellQty;
    let nonDeliverySellQty = 0;
    let deliveryBuyValuePaise;
    let deliverySellValuePaise;
    let nonDeliverySellValuePaise = 0;

    if (g.settlementType === "NON_NETTED") {
      deliveryBuyQty = buyQty;
      deliverySellQty = sellQty;
      deliveryBuyValuePaise = buyValuePaise;
      deliverySellValuePaise = sellValuePaise;
    } else {
      const totalQty = g.buyQty + g.sellQty;
      const totalValue = g.buyValuePaise + g.sellValuePaise;
      let vwapPaise = 0;
      if (totalQty > 0n) {
        // VWAP in rupees rounded to two decimals == integer paise.
        vwapPaise = roundRatioHalfUp(totalValue, totalQty);
      }
      deliveryBuyQty = Math.max(buyQty - sellQty, 0);
      deliverySellQty = Math.max(sellQty - buyQty, 0);
      nonDeliverySellQty = Math.min(buyQty, sellQty);
      deliveryBuyValuePaise = Number(BigInt(deliveryBuyQty) * BigInt(vwapPaise));
      deliverySellValuePaise = Number(BigInt(deliverySellQty) * BigInt(vwapPaise));
      nonDeliverySellValuePaise = Number(BigInt(nonDeliverySellQty) * BigInt(vwapPaise));
      for (const value of [deliveryBuyValuePaise, deliverySellValuePaise, nonDeliverySellValuePaise]) {
        safeInteger(value, "derived settlement value");
      }
    }

    const deliveryBuySttPaise = roundSttToPaise(deliveryBuyValuePaise, DELIVERY_RATE);
    const deliverySellSttPaise = roundSttToPaise(deliverySellValuePaise, DELIVERY_RATE);
    const nonDeliverySellSttPaise = roundSttToPaise(nonDeliverySellValuePaise, NON_DELIVERY_SELL_RATE);
    const groupSttPaise = deliveryBuySttPaise + deliverySellSttPaise + nonDeliverySellSttPaise;
    safeInteger(groupSttPaise, "group STT");

    outputGroups.push(Object.freeze({
      clientId: g.clientId,
      securityId: g.securityId,
      settlementId: g.settlementId,
      tradeDate: g.tradeDate,
      settlementType: g.settlementType,
      tradeCount: g.tradeCount,
      buyQty,
      sellQty,
      deliveryBuyQty,
      deliverySellQty,
      nonDeliverySellQty,
      deliveryBuyValuePaise,
      deliverySellValuePaise,
      nonDeliverySellValuePaise,
      deliveryBuySttPaise,
      deliverySellSttPaise,
      nonDeliverySellSttPaise,
      groupSttPaise,
      rateVersion: RATE_VERSION
    }));

    const clientDayKey = JSON.stringify([g.clientId, g.tradeDate]);
    const clientDay = clientTotals.get(clientDayKey) || { clientId: g.clientId, tradeDate: g.tradeDate, total: 0n };
    clientDay.total += BigInt(groupSttPaise);
    clientTotals.set(clientDayKey, clientDay);
  }

  const clients = [...clientTotals.values()].map(({ clientId, tradeDate, total }) => {
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError("Client STT aggregate exceeds supported safe integer range.");
    }
    const totalPaise = Number(total);
    const payableRupees = roundPaiseToNearestRupee(totalPaise);
    return Object.freeze({
      clientId,
      tradeDate,
      totalSttPaise: totalPaise,
      payableSttRupees: payableRupees,
      roundedPayablePaise: payableRupees * 100,
      aggregationKey: "CLIENT_TRADE_DATE"
    });
  });

  outputGroups.sort((a, b) =>
    a.clientId.localeCompare(b.clientId) ||
    a.securityId.localeCompare(b.securityId) ||
    a.settlementId.localeCompare(b.settlementId)
  );
  clients.sort((a, b) => a.clientId.localeCompare(b.clientId));

  return Object.freeze({
    groups: Object.freeze(outputGroups),
    clients: Object.freeze(clients),
    rateVersion: RATE_VERSION,
    verifiedThrough: VERIFIED_THROUGH
  });
}

module.exports = Object.freeze({ aggregateCashEquityStt, RATE_VERSION, VERIFIED_THROUGH });
