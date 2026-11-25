"use strict";

/*
 * Audit-only, synthetic Demo wallet ledger.
 * It consumes explicit cash and reservation facts; it never derives F&O margin,
 * calls a broker, writes to Supabase, or changes a production account.
 */
const ASSETS = new Set(["EQUITY", "FUTURE", "OPTION"]);
const clone = value => JSON.parse(JSON.stringify(value));
const fail = code => { throw Object.assign(new Error(code), { code }); };
const integer = (value, code, signed = false) => {
  if (!Number.isSafeInteger(value) || (!signed && value < 0)) fail(code);
  return value;
};
const required = (value, code) => {
  if (typeof value !== "string" || !value.trim()) fail(code);
  return value;
};
const stable = value => {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
  return JSON.stringify(value);
};

function createDemoWalletLedger({ accountId, openingCashPaise, openingEvidenceRef, env = {} } = {}) {
  if (env.NODE_ENV === "production" || env.production === true) fail("DEMO_WALLET_LEDGER_DISABLED_IN_PRODUCTION");
  required(accountId, "DEMO_WALLET_ACCOUNT_ID_REQUIRED");
  if (!accountId.startsWith("mock-")) fail("DEMO_WALLET_SYNTHETIC_ACCOUNT_REQUIRED");
  integer(openingCashPaise, "DEMO_WALLET_INVALID_OPENING_CASH");
  required(openingEvidenceRef, "DEMO_WALLET_OPENING_EVIDENCE_REQUIRED");

  const events = new Map();
  const reservations = new Map();
  const fillSettlements = new Map();
  let cashPaise = openingCashPaise;

  function blockedPaise() {
    let total = 0;
    for (const item of reservations.values()) {
      total += item.amountPaise;
      if (!Number.isSafeInteger(total)) fail("DEMO_WALLET_BLOCKED_TOTAL_OUT_OF_RANGE");
    }
    return total;
  }

  function append(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) fail("DEMO_WALLET_INVALID_EVENT");
    const common = {
      eventId: required(input.eventId, "DEMO_WALLET_EVENT_ID_REQUIRED"),
      sourceEventId: required(input.sourceEventId, "DEMO_WALLET_SOURCE_EVENT_REQUIRED"),
      evidenceRef: required(input.evidenceRef, "DEMO_WALLET_EVENT_EVIDENCE_REQUIRED"),
      occurredAt: required(input.occurredAt, "DEMO_WALLET_EVENT_TIME_REQUIRED"),
      assetClass: input.assetClass
    };
    if (!Number.isFinite(Date.parse(common.occurredAt))) fail("DEMO_WALLET_INVALID_EVENT_TIME");
    if (!ASSETS.has(common.assetClass)) fail("DEMO_WALLET_INVALID_ASSET");
    let event;

    if (input.type === "CASH_MOVEMENT") {
      event = { ...common, type: input.type,
        orderId: required(input.orderId, "DEMO_WALLET_ORDER_ID_REQUIRED"),
        fillId: required(input.fillId, "DEMO_WALLET_FILL_ID_REQUIRED"),
        cashDeltaPaise: integer(input.cashDeltaPaise, "DEMO_WALLET_INVALID_CASH_DELTA", true) };
    } else if (input.type === "ORDER_REFERENCE") {
      event = { ...common, type: input.type,
        orderId: required(input.orderId, "DEMO_WALLET_ORDER_ID_REQUIRED") };
    } else if (input.type === "RESERVATION_OPENED") {
      event = { ...common, type: input.type,
        reservationId: required(input.reservationId, "DEMO_WALLET_RESERVATION_ID_REQUIRED"),
        orderId: required(input.orderId, "DEMO_WALLET_ORDER_ID_REQUIRED"),
        amountPaise: integer(input.amountPaise, "DEMO_WALLET_INVALID_RESERVATION") };
      if (event.amountPaise < 1) fail("DEMO_WALLET_DUPLICATE_OR_EMPTY_RESERVATION");
    } else if (input.type === "RESERVATION_REDUCED") {
      event = { ...common, type: input.type,
        reservationId: required(input.reservationId, "DEMO_WALLET_RESERVATION_ID_REQUIRED"),
        orderId: required(input.orderId, "DEMO_WALLET_ORDER_ID_REQUIRED"),
        amountPaise: integer(input.amountPaise, "DEMO_WALLET_INVALID_RESERVATION_REDUCTION") };
      if (event.amountPaise < 1) fail("DEMO_WALLET_RESERVATION_REDUCTION_OUT_OF_RANGE");
    } else {
      fail("DEMO_WALLET_UNKNOWN_EVENT_TYPE");
    }

    const prior = events.get(event.eventId);
    if (prior) {
      if (stable(prior) !== stable(event)) fail("DEMO_WALLET_EVENT_ID_REUSED");
      return { duplicate: true, event: clone(prior) };
    }

    if (event.type === "ORDER_REFERENCE") {
      // Evidence-only link to an existing canonical order; no cash or reservation mutation.
    } else if (event.type === "CASH_MOVEMENT") {
      const priorFill = fillSettlements.get(event.fillId);
      if (priorFill) fail("DEMO_WALLET_FILL_SETTLED_MORE_THAN_ONCE");
      const nextCash = cashPaise + event.cashDeltaPaise;
      if (!Number.isSafeInteger(nextCash) || nextCash < 0) fail("DEMO_WALLET_CASH_OUT_OF_RANGE");
      cashPaise = nextCash;
      fillSettlements.set(event.fillId, event.eventId);
    } else if (event.type === "RESERVATION_OPENED") {
      if (reservations.has(event.reservationId)) fail("DEMO_WALLET_DUPLICATE_OR_EMPTY_RESERVATION");
      if (event.amountPaise > cashPaise - blockedPaise()) fail("DEMO_WALLET_INSUFFICIENT_AVAILABLE_CASH");
      reservations.set(event.reservationId, { reservationId: event.reservationId,
        orderId: event.orderId, assetClass: event.assetClass, amountPaise: event.amountPaise });
    } else {
      const current = reservations.get(event.reservationId);
      if (!current) fail("DEMO_WALLET_RESERVATION_NOT_FOUND");
      if (event.orderId !== current.orderId) fail("DEMO_WALLET_RESERVATION_ORDER_MISMATCH");
      if (event.amountPaise > current.amountPaise) fail("DEMO_WALLET_RESERVATION_REDUCTION_OUT_OF_RANGE");
      current.amountPaise -= event.amountPaise;
      if (current.amountPaise === 0) reservations.delete(event.reservationId);
    }

    events.set(event.eventId, event);
    return { duplicate: false, event: clone(event) };
  }

  function snapshot() {
    const blockedFundsPaise = blockedPaise();
    return clone({
      accountId, currency: "INR", openingCashPaise, cashPaise, blockedFundsPaise,
      availableCashPaise: cashPaise - blockedFundsPaise,
      reservations: [...reservations.values()].sort((a, b) => a.reservationId.localeCompare(b.reservationId)),
      events: [...events.values()],
      settledFillIds: [...fillSettlements.keys()].sort(),
      ledgerReconciled: false,
      reconciliationStatus: "not_reconciled",
      reconciliationBlockers: [
        "No authoritative, transactionally consistent source snapshot has attested this ledger.",
        "Every Equity, Futures and Options fill and active reservation must be matched to authoritative engine receipts.",
        "Futures and Options reservation amounts must come from an approved deterministic margin calculation, not an inferred estimate."
      ]
    });
  }

  function audit({ accountSnapshot, sourceOrders, sourceFills, sourceReservations, evidence } = {}) {
    if (!accountSnapshot || !Array.isArray(sourceOrders) || !Array.isArray(sourceFills) ||
        !Array.isArray(sourceReservations) || !evidence || typeof evidence !== "object") {
      fail("DEMO_WALLET_AUDIT_INPUTS_REQUIRED");
    }
    const current = snapshot();
    const arithmeticMatches =
      accountSnapshot.accountId === accountId &&
      accountSnapshot.cashBalancePaise === current.cashPaise &&
      accountSnapshot.blockedFundsPaise === current.blockedFundsPaise &&
      accountSnapshot.availableFundsPaise === current.availableCashPaise &&
      accountSnapshot.cashBalancePaise === accountSnapshot.blockedFundsPaise + accountSnapshot.availableFundsPaise;

    const orderIds = new Set(sourceOrders.map(x => required(x?.orderId, "DEMO_WALLET_SOURCE_ORDER_ID_REQUIRED")));
    const fillIds = new Set(sourceFills.map(x => required(x?.fillId, "DEMO_WALLET_SOURCE_FILL_ID_REQUIRED")));
    const reservationIds = new Set(sourceReservations.map(x => required(x?.reservationId, "DEMO_WALLET_SOURCE_RESERVATION_ID_REQUIRED")));
    const duplicate = (items, key) => items.length !== new Set(items.map(x => x[key])).size;
    const duplicateSourceIds = duplicate(sourceOrders, "orderId") || duplicate(sourceFills, "fillId") ||
      duplicate(sourceReservations, "reservationId");
    const ledgerOrderFacts = current.events.filter(x => x.orderId);
    const ledgerFillFacts = current.events.filter(x => x.type === "CASH_MOVEMENT");
    const ledgerOrderById = new Map();
    for (const fact of ledgerOrderFacts) {
      const prior = ledgerOrderById.get(fact.orderId);
      if (prior && prior !== fact.assetClass) ledgerOrderById.set(fact.orderId, null);
      else ledgerOrderById.set(fact.orderId, fact.assetClass);
    }
    const ledgerFillById = new Map(ledgerFillFacts.map(x => [x.fillId, x]));
    const ledgerReservationIds = new Set(current.reservations.map(x => x.reservationId));
    const allOrdersReferenced = sourceOrders.every(source =>
      ASSETS.has(source.assetClass) && ledgerOrderById.get(source.orderId) === source.assetClass);
    const allFillsSettled = sourceFills.every(source => {
      const settlement = ledgerFillById.get(source.fillId);
      return settlement && settlement.orderId === source.orderId && settlement.assetClass === source.assetClass;
    }) && ledgerFillFacts.length === sourceFills.length;
    // A matching fill ID is not enough: prove the cash direction and exact gross
    // amount against the authoritative source fill receipt.
    const settlementAmountsMatch = sourceFills.every(source => {
      const settlement = ledgerFillById.get(source.fillId);
      if (!settlement || !["BUY", "SELL"].includes(source.side) ||
          !Number.isSafeInteger(source.quantity) || source.quantity < 1 ||
          !Number.isSafeInteger(source.pricePaise) || source.pricePaise < 1 ||
          !Number.isSafeInteger(source.grossValuePaise) || source.grossValuePaise < 1 ||
          source.quantity * source.pricePaise !== source.grossValuePaise) return false;
      const expectedDelta = source.side === "BUY" ? -source.grossValuePaise : source.grossValuePaise;
      return settlement.cashDeltaPaise === expectedDelta;
    }) && ledgerFillFacts.length === sourceFills.length;
    const reservationsMatch = reservationIds.size === ledgerReservationIds.size &&
      [...reservationIds].every(id => ledgerReservationIds.has(id)) &&
      sourceReservations.every(source => current.reservations.some(local =>
        local.reservationId === source.reservationId && local.orderId === source.orderId &&
        local.amountPaise === source.amountPaise && local.assetClass === source.assetClass &&
        ASSETS.has(source.assetClass) && orderIds.has(source.orderId)));

    const evidenceRefs = ["accountSnapshotRef", "ordersSnapshotRef", "fillsSnapshotRef",
      "reservationsSnapshotRef", "eventHistoryRef", "atomicSnapshotAttestationRef"];
    const evidenceComplete = evidenceRefs.every(key => typeof evidence[key] === "string" && evidence[key].trim());
    const blockers = [];
    if (!arithmeticMatches) blockers.push("Account cash, blocked and available balances do not match the ledger.");
    if (duplicateSourceIds) blockers.push("Source order, fill or reservation identifiers are duplicated.");
    if (!allOrdersReferenced) blockers.push("One or more source orders have no matching asset-scoped canonical wallet ledger reference.");
    if (!allFillsSettled) blockers.push("Source fills and exactly-once cash settlement receipts do not match.");
    if (!settlementAmountsMatch) blockers.push("Cash settlement direction or exact gross amount does not match the source fill receipt.");
    if (!reservationsMatch) blockers.push("Active source reservations do not exactly match ledger reservations.");
    if (!evidenceComplete) blockers.push("Required independent snapshot and atomic-consistency evidence references are incomplete.");
    blockers.push("The audit helper cannot independently verify external evidence authenticity or atomic snapshot provenance.");

    return clone({
      accountId, arithmeticMatches, allOrdersReferenced, allFillsSettled, settlementAmountsMatch, reservationsMatch,
      duplicateSourceIds, evidenceComplete, ledgerReconciled: false,
      reconciliationStatus: "calculated_unattested", reconciliationBlockers: blockers,
      evidenceRefs: evidenceComplete ? evidenceRefs.map(key => ({ key, ref: evidence[key] })) : []
    });
  }

  function replay(log) {
    if (!Array.isArray(log)) fail("DEMO_WALLET_INVALID_EVENT_LOG");
    const rebuilt = createDemoWalletLedger({ accountId, openingCashPaise, openingEvidenceRef, env });
    for (const event of log) rebuilt.append(event);
    return rebuilt.snapshot();
  }

  return Object.freeze({ append, snapshot, audit, replay, exportEvents: () => clone([...events.values()]) });
}

module.exports = { createDemoWalletLedger };
