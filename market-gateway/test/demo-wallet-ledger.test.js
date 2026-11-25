"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDemoWalletLedger } = require("../lib/demo-wallet-ledger");

const at = "2026-11-25T10:00:00+05:30";
const create = () => createDemoWalletLedger({
  accountId: "mock-account-user-a",
  openingCashPaise: 100000000,
  openingEvidenceRef: "fixture:account:opening",
  env: { NODE_ENV: "test" }
});
const event = (overrides = {}) => ({
  eventId: "evt-00000001", sourceEventId: "source-0001", evidenceRef: "fixture:equity:fill-1",
  occurredAt: at, assetClass: "EQUITY", type: "CASH_MOVEMENT",
  orderId: "order-1", fillId: "fill-1", cashDeltaPaise: -250000, ...overrides
});

test("tracks opening cash, cash movements, blocked reservations and available funds in integer paise", () => {
  const ledger = create();
  ledger.append({ ...event(), eventId: "cash-buy-0001" });
  ledger.append({ ...event({ type: "RESERVATION_OPENED", eventId: "reserve-0001", sourceEventId: "order-1",
    reservationId: "reservation-1", amountPaise: 500000, fillId: undefined, cashDeltaPaise: undefined }) });
  const s = ledger.snapshot();
  assert.equal(s.cashPaise, 99750000);
  assert.equal(s.blockedFundsPaise, 500000);
  assert.equal(s.availableCashPaise, 99250000);
  assert.equal(s.ledgerReconciled, false);
});

test("reservation reductions release only the explicit remainder and are bounded", () => {
  const ledger = create();
  ledger.append({ ...event(), type: "RESERVATION_OPENED", eventId: "reserve-1",
    sourceEventId: "order-1", reservationId: "r-1", amountPaise: 1000000,
    fillId: undefined, cashDeltaPaise: undefined });
  ledger.append({ ...event(), type: "RESERVATION_REDUCED", eventId: "release-1",
    sourceEventId: "fill-1", reservationId: "r-1", orderId: "order-1", amountPaise: 400000,
    fillId: undefined, cashDeltaPaise: undefined });
  assert.equal(ledger.snapshot().blockedFundsPaise, 600000);
  assert.throws(() => ledger.append({ ...event(), type: "RESERVATION_REDUCED", eventId: "release-2",
    sourceEventId: "cancel-1", reservationId: "r-1", orderId: "order-1", amountPaise: 700000,
    fillId: undefined, cashDeltaPaise: undefined }), /RESERVATION_REDUCTION_OUT_OF_RANGE/);
});

test("duplicate cash settlement is idempotent only for the same event ID and fill", () => {
  const ledger = create();
  const first = ledger.append(event());
  assert.equal(ledger.append(event()).duplicate, true);
  assert.equal(ledger.snapshot().cashPaise, 99750000);
  assert.throws(() => ledger.append(event({ eventId: "cash-buy-0002" })), /FILL_SETTLED_MORE_THAN_ONCE/);
  assert.equal(first.duplicate, false);
});

test("rejects reused event IDs with different payloads", () => {
  const ledger = create();
  ledger.append(event());
  assert.throws(() => ledger.append(event({ cashDeltaPaise: -300000 })), /EVENT_ID_REUSED/);
});

test("requires explicit evidence, synthetic account, safe amounts and non-production environment", () => {
  assert.throws(() => createDemoWalletLedger({ accountId: "user-1", openingCashPaise: 1,
    openingEvidenceRef: "ref" }), /SYNTHETIC_ACCOUNT_REQUIRED/);
  assert.throws(() => createDemoWalletLedger({ accountId: "mock-a", openingCashPaise: 1,
    openingEvidenceRef: "ref", env: { NODE_ENV: "production" } }), /DISABLED_IN_PRODUCTION/);
  assert.throws(() => createDemoWalletLedger({ accountId: "mock-a", openingCashPaise: Number.MAX_SAFE_INTEGER + 1,
    openingEvidenceRef: "ref" }), /INVALID_OPENING_CASH/);
  assert.throws(() => createDemoWalletLedger({ accountId: "mock-a", openingCashPaise: 1 }), /OPENING_EVIDENCE_REQUIRED/);
});

test("replay reconstructs the exact wallet and reservation state", () => {
  const ledger = create();
  ledger.append({ ...event(), eventId: "cash-1" });
  ledger.append({ ...event(), type: "RESERVATION_OPENED", eventId: "reserve-1",
    sourceEventId: "order-2", orderId: "order-2", reservationId: "r-2", amountPaise: 500000,
    fillId: undefined, cashDeltaPaise: undefined });
  assert.deepEqual(ledger.replay(ledger.exportEvents()), ledger.snapshot());
});

test("audit checks source orders, fills, reservations and balance arithmetic but never attests reconciliation", () => {
  const ledger = create();
  ledger.append(event());
  const result = ledger.audit({
    accountSnapshot: { accountId: "mock-account-user-a", cashBalancePaise: 99750000,
      blockedFundsPaise: 0, availableFundsPaise: 99750000 },
    sourceOrders: [{ orderId: "order-1", assetClass: "EQUITY" }],
    sourceFills: [{ fillId: "fill-1", orderId: "order-1", assetClass: "EQUITY",
      side: "BUY", quantity: 2, pricePaise: 125000, grossValuePaise: 250000 }],
    sourceReservations: [],
    evidence: { accountSnapshotRef: "a", ordersSnapshotRef: "o", fillsSnapshotRef: "f",
      reservationsSnapshotRef: "r", eventHistoryRef: "h", atomicSnapshotAttestationRef: "atomic" }
  });
  assert.equal(result.arithmeticMatches, true);
  assert.equal(result.allOrdersReferenced, true);
  assert.equal(result.allFillsSettled, true);
  assert.equal(result.settlementAmountsMatch, true);
  assert.equal(result.reservationsMatch, true);
  assert.equal(result.evidenceComplete, true);
  assert.equal(result.ledgerReconciled, false);
  assert.ok(result.reconciliationBlockers.some(x => x.includes("cannot independently verify")));
});


test("audit rejects matching fill IDs when cash amount or BUY/SELL direction is wrong", () => {
  const sourceFill = {
    fillId: "fill-1", orderId: "order-1", assetClass: "EQUITY",
    side: "BUY", quantity: 2, pricePaise: 125000, grossValuePaise: 250000
  };
  const audit = ledger => ledger.audit({
    accountSnapshot: {
      accountId: "mock-account-user-a",
      cashBalancePaise: ledger.snapshot().cashPaise,
      blockedFundsPaise: ledger.snapshot().blockedFundsPaise,
      availableFundsPaise: ledger.snapshot().availableCashPaise
    },
    sourceOrders: [{ orderId: "order-1", assetClass: "EQUITY" }],
    sourceFills: [sourceFill],
    sourceReservations: [],
    evidence: {
      accountSnapshotRef: "a", ordersSnapshotRef: "o", fillsSnapshotRef: "f",
      reservationsSnapshotRef: "r", eventHistoryRef: "h", atomicSnapshotAttestationRef: "atomic"
    }
  });

  const wrongAmount = create();
  wrongAmount.append(event({ cashDeltaPaise: -249999 }));
  const amountResult = audit(wrongAmount);
  assert.equal(amountResult.allFillsSettled, true);
  assert.equal(amountResult.settlementAmountsMatch, false);
  assert.equal(amountResult.ledgerReconciled, false);

  const wrongDirection = create();
  wrongDirection.append(event({ cashDeltaPaise: 250000 }));
  const directionResult = audit(wrongDirection);
  assert.equal(directionResult.allFillsSettled, true);
  assert.equal(directionResult.settlementAmountsMatch, false);
  assert.equal(directionResult.ledgerReconciled, false);
});

test("rejects a fill cash debit that would make cash negative", () => {
  const ledger = createDemoWalletLedger({ accountId: "mock-small", openingCashPaise: 10,
    openingEvidenceRef: "fixture:small", env: { NODE_ENV: "test" } });
  assert.throws(() => ledger.append(event({ cashDeltaPaise: -11 })), /CASH_OUT_OF_RANGE/);
});

test("supports explicit Equity, Futures and Options reservation provenance without inventing margin rates", () => {
  const ledger = create();
  for (const [assetClass, id] of [["EQUITY", "eq"], ["FUTURE", "fu"], ["OPTION", "op"]]) {
    ledger.append({ eventId: "reserve-" + id, sourceEventId: "order-" + id,
      evidenceRef: "fixture:" + id, occurredAt: at, assetClass, type: "RESERVATION_OPENED",
      reservationId: "r-" + id, orderId: "order-" + id, amountPaise: 1000 });
  }
  assert.equal(ledger.snapshot().blockedFundsPaise, 3000);
  assert.equal(ledger.snapshot().reservations.length, 3);
  assert.equal(ledger.snapshot().ledgerReconciled, false);
});

test("audit rejects cross-asset source substitution and missing settlement receipts", () => {
  const ledger = create();
  ledger.append(event());
  const base = {
    accountSnapshot: { accountId: "mock-account-user-a", cashBalancePaise: 99750000,
      blockedFundsPaise: 0, availableFundsPaise: 99750000 },
    sourceOrders: [{ orderId: "order-1", assetClass: "FUTURE" }],
    sourceFills: [{ fillId: "fill-1", orderId: "order-1", assetClass: "FUTURE",
      side: "BUY", quantity: 2, pricePaise: 125000, grossValuePaise: 250000 }],
    sourceReservations: [],
    evidence: {}
  };
  const result = ledger.audit(base);
  assert.equal(result.allOrdersReferenced, false);
  assert.equal(result.allFillsSettled, false);
  assert.equal(result.ledgerReconciled, false);
});
