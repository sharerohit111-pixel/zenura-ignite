/* ZENURA IGNITE — isolated NSE/BSE cash-equity DEMO JSON execution engine.
 * This module never calls a broker, network, gateway, or database.
 * All money is integer paise. Demo fee defaults to zero; it is not an exchange fee model.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZENURA_EQUITY_DUMMY_ENGINE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SIDES = new Set(['BUY', 'SELL']);
  const PRODUCTS = new Set(['INTRADAY', 'DELIVERY']);
  const TYPES = new Set(['MARKET', 'LIMIT']);
  const TERMINAL = new Set(['FILLED', 'CANCELLED', 'REJECTED']);
  const safeInt = value => Number.isSafeInteger(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const keyForPosition = (product, instrumentKey) => product + '::' + instrumentKey;

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  function fingerprint(input) {
    return JSON.stringify({
      instrumentKey: input.instrumentKey, side: input.side, product: input.product,
      orderType: input.orderType, quantity: input.quantity,
      limitPricePaise: input.limitPricePaise ?? null
    });
  }

  function createEngine(options = {}) {
    const fixtures = options.fixtures || {};
    const instrumentRows = options.instruments || fixtures.instruments || [];
    const startingCashPaise = options.startingCashPaise ?? fixtures.startingCashPaise ?? 100000000;
    const feePerFillPaise = options.feePerFillPaise ?? fixtures.feePerFillPaise ?? 0;
    assert(safeInt(startingCashPaise) && startingCashPaise >= 0, 'Invalid starting cash.');
    assert(safeInt(feePerFillPaise) && feePerFillPaise >= 0, 'Invalid demo fee.');
    const instruments = new Map();
    for (const row of instrumentRows) {
      assert(row && typeof row.instrumentKey === 'string' && row.instrumentKey, 'Invalid instrument key.');
      assert(!instruments.has(row.instrumentKey), 'Duplicate instrument key.');
      assert(safeInt(row.tickSizePaise) && row.tickSizePaise > 0, 'Invalid instrument tick size.');
      assert(safeInt(row.quotePaise) && row.quotePaise > 0, 'Invalid demo quote.');
      assert(safeInt(row.maxFillQuantity) && row.maxFillQuantity > 0, 'Invalid demo fill cap.');
      instruments.set(row.instrumentKey, clone(row));
    }

    const state = {
      mode: 'DEMO_JSON',
      label: 'DEMO DATA — NOT LIVE NSE/BSE PRICES',
      startingCashPaise,
      cashPaise: startingCashPaise,
      reservedCashPaise: 0,
      positions: new Map(),
      orders: new Map(),
      fills: [],
      idempotency: new Map(),
      nextOrder: 1,
      nextExecution: 1
    };

    function position(product, instrumentKey) {
      const key = keyForPosition(product, instrumentKey);
      if (!state.positions.has(key)) state.positions.set(key, {
        product, instrumentKey, quantity: 0, reservedQuantity: 0, costBasisPaise: 0
      });
      return state.positions.get(key);
    }
    function availableQuantity(product, instrumentKey) {
      const p = position(product, instrumentKey);
      return p.quantity - p.reservedQuantity;
    }
    function availableCashPaise() {
      return state.cashPaise - state.reservedCashPaise;
    }
    function snapshotOrder(order) { return clone(order); }
    function snapshot() {
      return {
        mode: state.mode, label: state.label,
        startingCashPaise: state.startingCashPaise,
        cashPaise: state.cashPaise,
        reservedCashPaise: state.reservedCashPaise,
        availableCashPaise: availableCashPaise(),
        positions: [...state.positions.values()].map(clone),
        orders: [...state.orders.values()].map(snapshotOrder),
        fills: state.fills.map(clone)
      };
    }
    function validateOrder(input) {
      assert(input && typeof input === 'object', 'Order payload is required.');
      assert(SIDES.has(input.side), 'Side must be BUY or SELL.');
      assert(PRODUCTS.has(input.product), 'Product must be INTRADAY or DELIVERY.');
      assert(TYPES.has(input.orderType), 'Order type must be MARKET or LIMIT.');
      assert(safeInt(input.quantity) && input.quantity > 0 && input.quantity <= 1000000, 'Quantity must be a whole number from 1 to 1,000,000.');
      assert(instruments.has(input.instrumentKey), 'Instrument is not present in the demo instrument master.');
      if (input.orderType === 'LIMIT') {
        assert(safeInt(input.limitPricePaise) && input.limitPricePaise > 0, 'LIMIT price must be a positive integer-paise value.');
        const tick = instruments.get(input.instrumentKey).tickSizePaise;
        assert(input.limitPricePaise % tick === 0, 'LIMIT price does not match the instrument tick size.');
      } else {
        assert(input.limitPricePaise === undefined || input.limitPricePaise === null, 'MARKET orders cannot contain a limit price.');
      }
    }
    function fill(order, quantity, pricePaise, executionId) {
      if (executionId) {
        const priorFill = state.fills.find(row => row.executionId === executionId);
        if (priorFill) {
          assert(priorFill.orderId === order.orderId && priorFill.quantity === quantity &&
            priorFill.executionPricePaise === pricePaise, 'Execution ID was replayed with a different fill payload.');
          return clone(priorFill);
        }
      }
      assert(!TERMINAL.has(order.status), 'Terminal orders cannot be filled.');
      assert(safeInt(quantity) && quantity > 0 && quantity <= order.remainingQuantity, 'Fill quantity exceeds the remaining order quantity.');
      assert(safeInt(pricePaise) && pricePaise > 0, 'Execution price must be positive integer paise.');
      const instrument = instruments.get(order.instrumentKey);
      assert(pricePaise % instrument.tickSizePaise === 0, 'Execution price does not match the instrument tick size.');
      if (order.orderType === 'LIMIT') {
        if (order.side === 'BUY') assert(pricePaise <= order.limitPricePaise, 'BUY limit price condition is not met.');
        else assert(pricePaise >= order.limitPricePaise, 'SELL limit price condition is not met.');
      }
      const p = position(order.product, order.instrumentKey);
      const grossPaise = pricePaise * quantity;
      assert(safeInt(grossPaise), 'Execution gross exceeds safe integer range.');
      const chargesPaise = feePerFillPaise;
      const totalPaise = grossPaise + chargesPaise;
      assert(safeInt(totalPaise), 'Execution total exceeds safe integer range.');

      if (order.side === 'BUY') {
        if (order.orderType === 'LIMIT') {
          const reservedRelease = order.reservedCashRemainingPaise === order.remainingReservedCashPaise
            ? order.remainingReservedCashPaise
            : Math.floor(order.remainingReservedCashPaise * quantity / order.remainingQuantity);
          order.remainingReservedCashPaise -= reservedRelease;
          state.reservedCashPaise -= reservedRelease;
        }
        assert(availableCashPaise() >= totalPaise, 'Insufficient available demo cash for execution.');
        state.cashPaise -= totalPaise;
        p.quantity += quantity;
        p.costBasisPaise += totalPaise;
      } else {
        if (order.orderType === 'LIMIT') {
          p.reservedQuantity -= quantity;
          order.remainingReservedQuantity -= quantity;
        }
        assert(p.quantity >= quantity, 'Insufficient demo shares for SELL execution.');
        // Assign the exact residual basis to the final close; intermediate rounding is deterministic.
        const basisPaise = quantity === p.quantity
          ? p.costBasisPaise
          : Math.floor(p.costBasisPaise * quantity / p.quantity);
        p.quantity -= quantity;
        p.costBasisPaise -= basisPaise;
        const proceedsPaise = grossPaise - chargesPaise;
        state.cashPaise += proceedsPaise;
        order.realizedPnlPaise += proceedsPaise - basisPaise;
      }

      const fillReceipt = {
        executionId: executionId || 'DEMO-EXEC-' + String(state.nextExecution++).padStart(8, '0'),
        orderId: order.orderId, instrumentKey: order.instrumentKey,
        tradingSymbol: order.tradingSymbol, side: order.side, product: order.product,
        orderType: order.orderType, quantity, executionPricePaise: pricePaise,
        grossPaise, chargesPaise, totalPaise,
        cumulativeFilledQuantity: order.filledQuantity + quantity,
        remainingQuantity: order.remainingQuantity - quantity,
        createdAt: order.createdAt,
        demo: true
      };
      assert(!state.fills.some(row => row.executionId === fillReceipt.executionId), 'Duplicate execution ID.');
      state.fills.push(fillReceipt);
      order.fills.push(fillReceipt.executionId);
      order.filledQuantity += quantity;
      order.remainingQuantity -= quantity;
      order.cumulativeGrossPaise += grossPaise;
      order.cumulativeChargesPaise += chargesPaise;
      order.averageExecutionPricePaise = Math.floor(order.cumulativeGrossPaise / order.filledQuantity);
      order.executionPricePaise = order.averageExecutionPricePaise;
      order.updatedAt = order.createdAt;
      if (order.remainingQuantity === 0) {
        order.status = 'FILLED';
        order.remainingReservedCashPaise = 0;
        order.remainingReservedQuantity = 0;
      } else {
        order.status = 'PARTIALLY_FILLED';
      }
      return clone(fillReceipt);
    }
    function submitOrder(input) {
      validateOrder(input);
      assert(typeof input.idempotencyKey === 'string' && input.idempotencyKey.length >= 8, 'A demo idempotency key is required.');
      const requestFingerprint = fingerprint(input);
      const prior = state.idempotency.get(input.idempotencyKey);
      if (prior) {
        assert(prior.fingerprint === requestFingerprint, 'Idempotency key was reused with a different order payload.');
        return snapshotOrder(state.orders.get(prior.orderId));
      }
      const instrument = instruments.get(input.instrumentKey);
      const now = input.createdAt || '2026-11-24T09:15:00+05:30';
      const order = {
        orderId: 'DEMO-ORDER-' + String(state.nextOrder++).padStart(6, '0'),
        instrumentKey: input.instrumentKey, tradingSymbol: instrument.tradingSymbol,
        side: input.side, product: input.product, orderType: input.orderType,
        quantity: input.quantity, filledQuantity: 0, remainingQuantity: input.quantity,
        limitPricePaise: input.limitPricePaise ?? null,
        executionPricePaise: null, averageExecutionPricePaise: null,
        cumulativeGrossPaise: 0, cumulativeChargesPaise: 0, realizedPnlPaise: 0,
        reservedCashPaise: 0, remainingReservedCashPaise: 0,
        reservedQuantity: 0, remainingReservedQuantity: 0,
        status: input.orderType === 'LIMIT' ? 'PENDING' : 'OPEN',
        cancelReason: null, fills: [], createdAt: now, updatedAt: now, demo: true
      };
      state.orders.set(order.orderId, order);
      state.idempotency.set(input.idempotencyKey, {fingerprint:requestFingerprint,orderId:order.orderId});

      if (input.orderType === 'LIMIT') {
        if (input.side === 'BUY') {
          const reserve = input.limitPricePaise * input.quantity;
          if (!safeInt(reserve) || reserve > availableCashPaise()) {
            order.status = 'REJECTED';
            order.rejectReason = 'INSUFFICIENT_DEMO_CASH';
            return snapshotOrder(order);
          }
          order.reservedCashPaise = reserve;
          order.remainingReservedCashPaise = reserve;
          state.reservedCashPaise += reserve;
        } else {
          if (availableQuantity(input.product, input.instrumentKey) < input.quantity) {
            order.status = 'REJECTED';
            order.rejectReason = 'INSUFFICIENT_DEMO_SHARES';
            return snapshotOrder(order);
          }
          order.reservedQuantity = input.quantity;
          order.remainingReservedQuantity = input.quantity;
          position(input.product, input.instrumentKey).reservedQuantity += input.quantity;
        }
        return snapshotOrder(order);
      }

      order.status = 'OPEN';
      const available = input.side === 'BUY'
        ? Math.floor(availableCashPaise() / (instrument.quotePaise + feePerFillPaise))
        : availableQuantity(input.product, input.instrumentKey);
      const quantity = Math.min(input.quantity, instrument.maxFillQuantity, available);
      if (quantity > 0) fill(order, quantity, instrument.quotePaise);
      if (order.remainingQuantity > 0) {
        order.status = order.filledQuantity > 0 ? 'CANCELLED' : 'REJECTED';
        order.cancelReason = order.filledQuantity > 0 ? 'MARKET_REMAINDER_IOC' : 'INSUFFICIENT_DEMO_FUNDS_OR_SHARES';
      }
      return snapshotOrder(order);
    }
    function executeFill(orderId, quantity, pricePaise, executionId) {
      const order = state.orders.get(orderId);
      assert(order, 'Demo order was not found.');
      return fill(order, quantity, pricePaise, executionId);
    }
    function processQuote(instrumentKey, pricePaise, options = {}) {
      const instrument = instruments.get(instrumentKey);
      assert(instrument, 'Instrument is not present in the demo instrument master.');
      assert(safeInt(pricePaise) && pricePaise > 0 && pricePaise % instrument.tickSizePaise === 0, 'Quote must be positive integer paise aligned to the instrument tick size.');
      instrument.quotePaise = pricePaise;
      const eligible = [...state.orders.values()].filter(order =>
        order.instrumentKey === instrumentKey && order.orderType === 'LIMIT' &&
        ['PENDING','PARTIALLY_FILLED'].includes(order.status) &&
        (order.side === 'BUY' ? pricePaise <= order.limitPricePaise : pricePaise >= order.limitPricePaise)
      );
      const receipts = [];
      for (const order of eligible) {
        if (TERMINAL.has(order.status)) continue;
        const cap = options.maxFillQuantity ?? instrument.maxFillQuantity;
        assert(safeInt(cap) && cap > 0, 'maxFillQuantity must be a positive integer.');
        const quantity = Math.min(order.remainingQuantity, cap);
        if (quantity <= 0) continue;
        try {
          const executionId = options.executionIdPrefix
            ? options.executionIdPrefix + ':' + order.orderId + ':' + order.filledQuantity
            : undefined;
          receipts.push(fill(order, quantity, pricePaise, executionId));
        } catch (error) {
          order.status = order.filledQuantity > 0 ? 'PARTIALLY_FILLED' : 'REJECTED';
          order.rejectReason = error.message;
        }
      }
      return receipts;
    }
    function cancelOrder(orderId) {
      const order = state.orders.get(orderId);
      assert(order, 'Demo order was not found.');
      if (order.status === 'CANCELLED') return snapshotOrder(order);
      assert(['PENDING','PARTIALLY_FILLED'].includes(order.status), 'Only an open LIMIT remainder can be cancelled.');
      if (order.side === 'BUY') {
        state.reservedCashPaise -= order.remainingReservedCashPaise;
        order.remainingReservedCashPaise = 0;
      } else {
        const p = position(order.product, order.instrumentKey);
        p.reservedQuantity -= order.remainingReservedQuantity;
        order.remainingReservedQuantity = 0;
      }
      order.status = 'CANCELLED';
      order.cancelReason = 'USER_CANCELLED_REMAINDER';
      order.updatedAt = order.createdAt;
      return snapshotOrder(order);
    }
    function getOrder(orderId) {
      const order = state.orders.get(orderId);
      return order ? snapshotOrder(order) : null;
    }
    function getTradeReceipts(orderId) {
      return state.fills.filter(row => !orderId || row.orderId === orderId).map(clone);
    }
    function getInstrumentMaster() {
      return [...instruments.values()].map(clone);
    }

    return Object.freeze({
      mode: 'DEMO_JSON', label: state.label,
      submitOrder, processQuote, executeFill, cancelOrder, getOrder,
      getTradeReceipts, getInstrumentMaster, snapshot
    });
  }

  return Object.freeze({createEngine});
});
