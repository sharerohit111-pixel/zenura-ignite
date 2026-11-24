"use strict";

// Provider-neutral read model for long NSE CE/PE paper positions.
// All monetary values are integer paise. Quote acquisition/verification belongs
// to the caller; this module only accepts normalized provider-agnostic snapshots.

const OPEN_ORDER_STATUSES = new Set(["PENDING", "PARTIALLY_FILLED"]);
const OPTION_TYPES = new Set(["CE", "PE"]);
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function fail(message) {
  throw Object.assign(new Error(message), { status: 422 });
}

function integer(value, label, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) fail(`${label} must be a safe integer >= ${min}.`);
  return value;
}

function signedInteger(value, label) {
  if (!Number.isSafeInteger(value)) fail(`${label} must be a safe integer.`);
  return value;
}

function addSafe(a, b, label) {
  const result = a + b;
  if (!Number.isSafeInteger(result)) fail(`${label} exceeds safe integer limits.`);
  return result;
}

function multiplySafe(a, b, label) {
  const result = a * b;
  if (!Number.isSafeInteger(result)) fail(`${label} exceeds safe integer limits.`);
  return result;
}

function isNseOption(row) {
  return row && row.exchange === "NSE" && row.segment === "NSE_FO" && OPTION_TYPES.has(row.instrument_type ?? row.instrumentType);
}

function normalizePosition(row) {
  if (!isNseOption(row)) return null;
  const quantity = integer(row.net_quantity, "Position quantity", { min: 1 });
  const lotSize = integer(row.lot_size, "Position lot size", { min: 1 });
  const reservedQuantity = integer(row.reserved_quantity ?? 0, "Reserved close quantity");
  const costBasisPaise = integer(row.cost_basis_paise, "Position cost basis", { min: 1 });
  const averagePremiumPaise = integer(row.average_price_paise, "Average premium", { min: 1 });
  if (quantity > 1_000_000 || quantity % lotSize !== 0 || reservedQuantity > quantity) {
    fail("Position quantity, lot-size multiple, or close reservation is inconsistent.");
  }
  if (Math.floor(costBasisPaise / quantity + 0.5) !== averagePremiumPaise) {
    fail("Position average premium does not reconcile to its fee-inclusive cost basis.");
  }
  return {
    instrumentKey: row.instrument_key,
    tradingSymbol: row.trading_symbol ?? row.instrument_key,
    instrumentType: row.instrument_type,
    expiry: row.expiry,
    quantity,
    lotSize,
    reservedCloseQuantity: reservedQuantity,
    availableCloseQuantity: quantity - reservedQuantity,
    costBasisPaise,
    premiumInvestedPaise: costBasisPaise,
    averagePremiumPaise
  };
}

function buildOptionsAccountingSnapshot({
  account,
  positions = [],
  limitOrders = [],
  limitFills = [],
  marketOrders = [],
  quotes = [],
  now = Date.now(),
  maxQuoteAgeMs = 15_000
}) {
  if (!account || typeof account !== "object") fail("Paper account snapshot is required.");
  integer(now, "Server time", { min: 1 });
  integer(maxQuoteAgeMs, "Maximum quote age", { min: 0 });
  const cashPaise = integer(account.cash_paise, "Cash balance");
  const accountReservedCashPaise = integer(account.reserved_cash_paise ?? 0, "Account reserved cash");
  const reservedMarginPaise = integer(account.reserved_margin_paise ?? 0, "Reserved margin");
  const realizedAccountPnlPaise = signedInteger(account.realized_pnl_paise ?? 0, "Account realized P&L");
  if (accountReservedCashPaise + reservedMarginPaise > cashPaise) {
    fail("Account reservations exceed cash balance.");
  }
  const availableCashPaise = cashPaise - accountReservedCashPaise - reservedMarginPaise;

  const normalizedPositions = positions.map(normalizePosition).filter(Boolean);
  const quoteMap = new Map();
  for (const quote of quotes) {
    if (!quote || typeof quote.instrumentKey !== "string" || quoteMap.has(quote.instrumentKey)) {
      fail("Quote snapshot contains an invalid or duplicate instrument key.");
    }
    const pricePaise = integer(quote.pricePaise, "Quote price", { min: 1 });
    const observedAtMs = integer(quote.observedAtMs, "Quote timestamp", { min: 1 });
    quoteMap.set(quote.instrumentKey, { pricePaise, observedAtMs });
  }

  let premiumInvestedPaise = 0;
  let marketValuePaise = 0;
  let unrealizedPnlPaise = 0;
  let stalePositions = 0;
  const valuedPositions = normalizedPositions.map(position => {
    premiumInvestedPaise = addSafe(premiumInvestedPaise, position.costBasisPaise, "Total premium invested");
    const quote = quoteMap.get(position.instrumentKey);
    const fresh = quote && quote.observedAtMs <= now && now - quote.observedAtMs <= maxQuoteAgeMs;
    if (!fresh) {
      stalePositions += 1;
      return { ...position, marketPricePaise: null, marketValuePaise: null, unrealizedPnlPaise: null, quoteStatus: "stale_or_unavailable" };
    }
    const value = multiplySafe(quote.pricePaise, position.quantity, "Position market value");
    const pnl = value - position.costBasisPaise;
    if (!Number.isSafeInteger(pnl)) fail("Position unrealized P&L exceeds safe integer limits.");
    marketValuePaise = addSafe(marketValuePaise, value, "Total market value");
    unrealizedPnlPaise = addSafe(unrealizedPnlPaise, pnl, "Total unrealized P&L");
    return { ...position, marketPricePaise: quote.pricePaise, marketValuePaise: value, unrealizedPnlPaise: pnl, quoteStatus: "fresh" };
  });

  let blockedPremiumPaise = 0;
  let reservedCloseQuantity = 0;
  const reservedCloseByInstrument = new Map();
  const activeLimitOrders = [];
  for (const order of limitOrders) {
    if (!isNseOption(order) || !OPEN_ORDER_STATUSES.has(order.status)) continue;
    const reservedCash = integer(order.reserved_cash_paise ?? 0, "Order reserved premium");
    const reservedClose = integer(order.reserved_close_quantity ?? 0, "Order reserved close quantity");
    if (order.side === "BUY") {
      if (reservedClose !== 0) fail("BUY order cannot reserve close quantity.");
      blockedPremiumPaise = addSafe(blockedPremiumPaise, reservedCash, "Blocked premium");
    } else if (order.side === "SELL") {
      if (reservedCash !== 0) fail("SELL order cannot reserve premium.");
      reservedCloseQuantity = addSafe(reservedCloseQuantity, reservedClose, "Reserved close quantity");
      reservedCloseByInstrument.set(order.instrument_key,
        addSafe(reservedCloseByInstrument.get(order.instrument_key) ?? 0, reservedClose, "Per-contract close reservation"));
    } else fail("Options order side is invalid.");
    activeLimitOrders.push(order);
  }
  for (const position of normalizedPositions) {
    if ((reservedCloseByInstrument.get(position.instrumentKey) ?? 0) !== position.reservedCloseQuantity) {
      fail("Position close reservation does not reconcile to its active Options LIMIT SELL orders.");
    }
  }
  for (const [instrumentKey, reserved] of reservedCloseByInstrument) {
    if (!normalizedPositions.some(position => position.instrumentKey === instrumentKey) && reserved > 0) {
      fail("An active Options LIMIT SELL reservation has no matching long position.");
    }
  }
  if (blockedPremiumPaise > accountReservedCashPaise) {
    fail("Blocked Options premium exceeds the account's aggregate reserved cash.");
  }

  let realizedPnlPaise = 0;
  let chargesPaidPaise = 0;
  const history = [];
  for (const order of marketOrders) {
    if (!isNseOption(order) || order.status !== "FILLED") continue;
    realizedPnlPaise = addSafe(realizedPnlPaise, signedInteger(order.realized_pnl_paise ?? 0, "Market order realized P&L"), "Options realized P&L");
    chargesPaidPaise = addSafe(chargesPaidPaise, integer(order.charges_paise ?? 0, "Market order charges"), "Options charges");
    history.push({ source: "MARKET", id: order.order_id, side: order.side, quantity: order.quantity, grossPaise: order.gross_paise, chargesPaise: order.charges_paise ?? 0, realizedPnlPaise: order.realized_pnl_paise ?? 0, status: order.status, createdAt: order.created_at });
  }
  const fillsByOrder = new Map();
  const seenExecutions = new Set();
  for (const fill of limitFills) {
    if (!fill || typeof fill.order_id !== "string" || typeof fill.execution_id !== "string") {
      fail("Options fill history contains an invalid order or execution reference.");
    }
    const identity = `${fill.order_id}:${fill.execution_id}`;
    if (seenExecutions.has(identity)) fail("Duplicate Options execution appears in fill history.");
    seenExecutions.add(identity);
    const prior = fillsByOrder.get(fill.order_id) ?? [];
    prior.push(fill);
    fillsByOrder.set(fill.order_id, prior);
  }
  const knownLimitOrderIds = new Set(limitOrders.filter(isNseOption).map(order => order.order_id));
  for (const orderId of fillsByOrder.keys()) {
    if (!knownLimitOrderIds.has(orderId)) fail("Options fill history contains an orphaned order reference.");
  }
  for (const order of limitOrders) {
    if (!isNseOption(order)) continue;
    const fills = fillsByOrder.get(order.order_id) ?? [];
    fills.sort((a, b) => a.fill_sequence - b.fill_sequence);
    let orderRealized = 0;
    let orderCharges = 0;
    let fillQuantity = 0;
    let fillGross = 0;
    for (let index = 0; index < fills.length; index += 1) {
      const fill = fills[index];
      if (integer(fill.fill_sequence, "LIMIT fill sequence", { min: 1 }) !== index + 1) {
        fail("Options fill sequence is not contiguous.");
      }
      fillQuantity = addSafe(fillQuantity, integer(fill.fill_quantity, "LIMIT fill quantity", { min: 1 }), "LIMIT filled quantity");
      fillGross = addSafe(fillGross, integer(fill.gross_paise, "LIMIT fill gross", { min: 1 }), "LIMIT fill gross");
      orderRealized = addSafe(orderRealized, signedInteger(fill.realized_pnl_paise ?? 0, "LIMIT fill realized P&L"), "LIMIT order realized P&L");
      orderCharges = addSafe(orderCharges, integer(fill.incremental_charges_paise ?? 0, "LIMIT fill charges"), "LIMIT order charges");
    }
    if (fillQuantity !== integer(order.filled_quantity ?? 0, "LIMIT order filled quantity")
        || fillGross !== integer(order.cumulative_gross_paise ?? 0, "LIMIT cumulative gross")
        || orderCharges !== integer(order.cumulative_charges_paise ?? 0, "LIMIT cumulative charges")) {
      fail("Options LIMIT order totals do not reconcile to its immutable fills.");
    }
    realizedPnlPaise = addSafe(realizedPnlPaise, orderRealized, "Options realized P&L");
    chargesPaidPaise = addSafe(chargesPaidPaise, orderCharges, "Options charges");
    history.push({ source: "LIMIT", id: order.order_id, side: order.side, quantity: order.quantity, filledQuantity: order.filled_quantity, grossPaise: order.cumulative_gross_paise, chargesPaise: order.cumulative_charges_paise, realizedPnlPaise: orderRealized, status: order.status, createdAt: order.created_at, fills: fills.map(fill => ({ executionId: fill.execution_id, sequence: fill.fill_sequence, quantity: fill.fill_quantity, pricePaise: fill.execution_price_paise, grossPaise: fill.gross_paise, chargesPaise: fill.incremental_charges_paise, realizedPnlPaise: fill.realized_pnl_paise })) });
  }
  history.sort((a, b) => Date.parse(b.createdAt ?? 0) - Date.parse(a.createdAt ?? 0));

  return Object.freeze({
    positions: valuedPositions,
    cashPaise,
    accountReservedCashPaise,
    reservedMarginPaise,
    availableCashPaise,
    blockedPremiumPaise,
    premiumInvestedPaise,
    reservedCloseQuantity,
    marketValuePaise: stalePositions ? null : marketValuePaise,
    unrealizedPnlPaise: stalePositions ? null : unrealizedPnlPaise,
    realizedPnlPaise,
    accountRealizedPnlPaise: realizedAccountPnlPaise,
    chargesPaidPaise,
    stalePositions,
    valuationStatus: normalizedPositions.length === 0 ? "no_open_positions" : stalePositions ? "partial_stale" : "fresh",
    history,
    simulationOnly: true,
    includesEntryCharges: true,
    excludesEstimatedExitCharges: true
  });
}

module.exports = { buildOptionsAccountingSnapshot };
