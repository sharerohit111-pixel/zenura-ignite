import test from "node:test";
import assert from "node:assert/strict";
import { createPaperDemoEventLedger, replayPaperDemoEvents } from "../../markets/shared/paper-demo-event-ledger.mjs";

const opening = { accountId: "mock-account-user-a", sessionId: "demo-session-a", cashBalancePaise: 100000000, blockedFundsPaise: 0 };
function event(overrides = {}) {
  return {
    eventId: "evt-1", idempotencyKey: "idem-1", sourceEventId: "equity-order-1",
    accountId: opening.accountId, sessionId: opening.sessionId,
    occurredAt: "2026-11-25T09:30:00+05:30", engine: "EQUITY", type: "ORDER_ACCEPTED",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 10000 },
    payload: { orderId: "order-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", orderType: "LIMIT", quantity: 2, status: "PENDING" },
    ...overrides
  };
}

function seedFuturesOrder(ledger, orderId, side = "BUY") {
  ledger.append(event({
    eventId: "seed-" + orderId, idempotencyKey: "idem-" + orderId,
    sourceEventId: "source-" + orderId, occurredAt: "2026-11-25T09:29:00+05:30",
    engine: "FUTURES", type: "ORDER_ACCEPTED",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { orderId, assetClass: "FUTURE", instrumentKey: "MOCK|NSE|FUT|NIFTY-2026-11", side, orderType: "LIMIT", quantity: 1, status: "PENDING" }
  }));
}
function seedOptionsFill(ledger, orderId, fillId, side = "BUY") {
  ledger.append(event({
    eventId: "seed-" + orderId, idempotencyKey: "idem-" + orderId,
    sourceEventId: "source-" + orderId, occurredAt: "2026-11-25T09:29:00+05:30",
    engine: "OPTIONS", type: "ORDER_ACCEPTED",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { orderId, assetClass: "OPTION", instrumentKey: "MOCK|NSE|OPT|NIFTY-26000-CE", side, orderType: "LIMIT", quantity: 1, status: "PENDING" }
  }));
  ledger.append(event({
    eventId: "fill-" + fillId, idempotencyKey: "idem-fill-" + fillId,
    sourceEventId: "source-fill-" + fillId, occurredAt: "2026-11-25T09:29:30+05:30",
    engine: "OPTIONS", type: "FILL_RECORDED",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { fillId, orderId, assetClass: "OPTION", instrumentKey: "MOCK|NSE|OPT|NIFTY-26000-CE", side, quantity: 1, pricePaise: 100000 }
  }));
}
test("opening snapshot derives available cash and never claims reconciliation", () => {
  const snapshot = createPaperDemoEventLedger(opening).snapshot();
  assert.equal(snapshot.account.cashBalancePaise, 100000000);
  assert.equal(snapshot.account.blockedFundsPaise, 0);
  assert.equal(snapshot.account.availableFundsPaise, 100000000);
  assert.equal(snapshot.account.ledgerReconciled, false);
});
test("cross-engine events share one ordered immutable event stream", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  ledger.append(event({
    eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "futures-order-1",
    engine: "FUTURES", type: "ORDER_ACCEPTED", occurredAt: "2026-11-25T09:30:01+05:30",
    payload: { orderId: "future-1", assetClass: "FUTURE", instrumentKey: "MOCK|NSE|FUT|NIFTY-2026-11", side: "BUY", orderType: "MARKET", quantity: 1, status: "PENDING" },
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 20000 }
  }));
  const snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.events.map(x => [x.sequence, x.engine]), [[1, "EQUITY"], [2, "FUTURES"]]);
  assert.equal(snapshot.account.blockedFundsPaise, 30000);
  assert.equal(snapshot.account.availableFundsPaise, 99970000);
  assert.ok(Object.isFrozen(snapshot.events[0]));
  assert.ok(Object.isFrozen(snapshot.events));
});
test("idempotent retries return the original event without double reserving cash", () => {
  const ledger = createPaperDemoEventLedger(opening), input = event();
  assert.equal(ledger.append(input).accepted, true);
  const retry = ledger.append(input);
  assert.equal(retry.accepted, false);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.snapshot.events.length, 1);
  assert.equal(retry.snapshot.account.blockedFundsPaise, 10000);
  assert.throws(() => ledger.append(event({ deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 20000 } })), /IDEMPOTENCY_KEY_REUSE_MISMATCH/);
});
test("fill must refer to an accepted order from the same engine and instrument", () => {
  const ledger = createPaperDemoEventLedger(opening);
  assert.throws(() => ledger.append(event({
    type: "FILL_RECORDED", payload: { fillId: "fill-1", orderId: "missing", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 1, pricePaise: 125050 },
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 }
  })), /FILL_ORDER_MISMATCH/);
  assert.equal(ledger.snapshot().events.length, 0);
  assert.equal(ledger.snapshot().account.cashBalancePaise, opening.cashBalancePaise);
});
test("cash and reservation invariants reject negative cash, negative blocks and overspending", () => {
  const ledger = createPaperDemoEventLedger(opening);
  assert.throws(() => ledger.append(event({ deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 100000001 } })), /DEMO_CASH_RESERVATION_INVARIANT/);
  assert.throws(() => ledger.append(event({ eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "cancel", deltas: { cashDeltaPaise: 0, blockedDeltaPaise: -1 } })), /DEMO_CASH_RESERVATION_INVARIANT/);
  assert.equal(ledger.snapshot().events.length, 0);
});
test("positions aggregate by asset class and MOCK instrument; realized P&L is projected", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event({ engine: "OPTIONS", type: "POSITION_CHANGED", deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { assetClass: "OPTION", instrumentKey: "MOCK|NSE|OPT|NIFTY-CE-26000", quantityDelta: 50, realizedPnlDeltaPaise: 1250 } }));
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.positions[0].quantity, 50);
  assert.equal(snapshot.positions[0].realizedPnlPaise, 1250);
  assert.equal(snapshot.account.realizedPnlPaise, 1250);
});
test("session and account boundaries reject cross-user events", () => {
  const ledger = createPaperDemoEventLedger(opening);
  assert.throws(() => ledger.append(event({ accountId: "mock-account-user-b" })), /DEMO_EVENT_SCOPE_MISMATCH/);
  assert.throws(() => ledger.append(event({ sessionId: "demo-session-b" })), /DEMO_EVENT_SCOPE_MISMATCH/);
  assert.equal(ledger.snapshot().events.length, 0);
});
test("event replay is deterministic and validates the original sequence", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  ledger.append(event({ eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "equity-fill-1",
    type: "FILL_RECORDED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: -125050, blockedDeltaPaise: -10000 },
    payload: { fillId: "fill-1", orderId: "order-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 1, pricePaise: 125050 } }));
  const original = ledger.snapshot();
  const replayed = replayPaperDemoEvents(opening, original.events);
  assert.deepEqual(replayed, original);
  assert.throws(() => replayPaperDemoEvents(opening, original.events.map((x, i) => ({ ...x, sequence: i + 2 }))), /DEMO_EVENT_SEQUENCE_MISMATCH/);
});
test("rejects live symbols, mismatched engine asset classes and out-of-order timestamps", () => {
  const ledger = createPaperDemoEventLedger(opening);
  assert.throws(() => ledger.append(event({ payload: { ...event().payload, instrumentKey: "NSE|RELIANCE" } })), /INVALID_ORDER_EVENT/);
  assert.throws(() => ledger.append(event({ engine: "OPTIONS" })), /ENGINE_ASSET_MISMATCH/);
  ledger.append(event());
  assert.throws(() => ledger.append(event({ eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "later", occurredAt: "2026-11-25T09:29:59+05:30" })), /DEMO_EVENT_TIME_ORDER_MISMATCH/);
});

test("source event identity cannot be replayed under a different event or idempotency key", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  assert.throws(() => ledger.append(event({
    eventId: "evt-2", idempotencyKey: "idem-2"
  })), /DUPLICATE_SOURCE_EVENT/);
});
test("order updates cannot mutate the original order identity", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  assert.throws(() => ledger.append(event({
    eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "update-1",
    type: "ORDER_UPDATED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { ...event().payload, quantity: 3, status: "PARTIALLY_FILLED" }
  })), /ORDER_IDENTITY_MUTATION/);
});
test("fill quantity cannot exceed the accepted order quantity", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event());
  assert.throws(() => ledger.append(event({
    eventId: "evt-2", idempotencyKey: "idem-2", sourceEventId: "fill-oversized",
    type: "FILL_RECORDED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: -125050, blockedDeltaPaise: -10000 },
    payload: { fillId: "fill-1", orderId: "order-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", side: "BUY", quantity: 3, pricePaise: 125050 }
  })), /FILL_QUANTITY_EXCEEDS_ORDER/);
});


test("product-aware positions keep Delivery and Intraday cost basis separate", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event({
    type: "POSITION_CHANGED", sourceEventId: "delivery-buy", idempotencyKey: "delivery-buy-1",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", quantityDelta: 2, costBasisDeltaPaise: 250100, realizedPnlDeltaPaise: 0 }
  }));
  ledger.append(event({
    eventId: "evt-2", idempotencyKey: "intraday-buy-1", sourceEventId: "intraday-buy",
    type: "POSITION_CHANGED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "INTRADAY", quantityDelta: 1, costBasisDeltaPaise: 125050, realizedPnlDeltaPaise: 0 }
  }));
  const positions = ledger.snapshot().positions;
  assert.equal(positions.length, 2);
  assert.equal(positions.find(x => x.product === "DELIVERY").averagePricePaise, 125050);
  assert.equal(positions.find(x => x.product === "INTRADAY").costBasisPaise, 125050);
});

test("SELL order acceptance reserves only unreserved shares; fills release reservation", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event({
    type: "POSITION_CHANGED", sourceEventId: "seed-position", idempotencyKey: "seed-position-1",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", quantityDelta: 5, costBasisDeltaPaise: 500000, realizedPnlDeltaPaise: 0 }
  }));
  ledger.append(event({
    eventId: "evt-2", idempotencyKey: "sell-order-1", sourceEventId: "sell-order",
    type: "ORDER_ACCEPTED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { orderId: "sell-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", side: "SELL", orderType: "LIMIT", quantity: 3, status: "PENDING" }
  }));
  assert.equal(ledger.snapshot().positions[0].reservedQuantity, 3);
  assert.throws(() => ledger.append(event({
    eventId: "evt-3", idempotencyKey: "sell-order-2", sourceEventId: "sell-order-2",
    type: "ORDER_ACCEPTED", occurredAt: "2026-11-25T09:30:02+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { orderId: "sell-2", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", side: "SELL", orderType: "MARKET", quantity: 3, status: "PENDING" }
  })), /DEMO_SHARE_RESERVATION_INVARIANT/);
  ledger.append(event({
    eventId: "evt-3", idempotencyKey: "sell-fill-1", sourceEventId: "sell-fill",
    type: "FILL_RECORDED", occurredAt: "2026-11-25T09:30:03+05:30",
    deltas: { cashDeltaPaise: 300000, blockedDeltaPaise: 0 },
    payload: { fillId: "sell-fill-1", orderId: "sell-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", side: "SELL", quantity: 3, pricePaise: 100000 }
  }));
  ledger.append(event({
    eventId: "evt-4", idempotencyKey: "sell-position-1", sourceEventId: "sell-position",
    type: "POSITION_CHANGED", occurredAt: "2026-11-25T09:30:04+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", quantityDelta: -3, costBasisDeltaPaise: -300000, realizedPnlDeltaPaise: 0 }
  }));
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.positions[0].quantity, 2);
  assert.equal(snapshot.positions[0].reservedQuantity, 0);
  assert.equal(snapshot.positions[0].costBasisPaise, 200000);
  assert.equal(snapshot.account.cashBalancePaise, opening.cashBalancePaise + 300000);
});

test("cancelled SELL remainder releases reserved shares without changing filled quantity", () => {
  const ledger = createPaperDemoEventLedger(opening);
  ledger.append(event({
    type: "POSITION_CHANGED", sourceEventId: "seed-position", idempotencyKey: "seed-position-1",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", quantityDelta: 4, costBasisDeltaPaise: 400000, realizedPnlDeltaPaise: 0 }
  }));
  ledger.append(event({
    eventId: "evt-2", idempotencyKey: "sell-order-1", sourceEventId: "sell-order",
    type: "ORDER_ACCEPTED", occurredAt: "2026-11-25T09:30:01+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { orderId: "sell-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", side: "SELL", orderType: "LIMIT", quantity: 3, status: "PENDING" }
  }));
  ledger.append(event({
    eventId: "evt-3", idempotencyKey: "sell-cancel-1", sourceEventId: "sell-cancel",
    type: "ORDER_UPDATED", occurredAt: "2026-11-25T09:30:02+05:30",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { orderId: "sell-1", assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", side: "SELL", orderType: "LIMIT", quantity: 3, status: "CANCELLED", reservedQuantityDelta: -3 }
  }));
  assert.equal(ledger.snapshot().positions[0].reservedQuantity, 0);
  assert.equal(ledger.snapshot().orders[0].status, "CANCELLED");
});

test("product-aware cost basis cannot become negative or outlive a flat position", () => {
  const ledger = createPaperDemoEventLedger(opening);
  assert.throws(() => ledger.append(event({
    type: "POSITION_CHANGED",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { assetClass: "EQUITY", instrumentKey: "MOCK|NSE|EQ|0001", product: "DELIVERY", quantityDelta: 0, costBasisDeltaPaise: -1, realizedPnlDeltaPaise: 0 }
  })), /DEMO_POSITION_INVARIANT/);
  assert.equal(ledger.snapshot().events.length, 0);
});

test("authoritative Futures settlement appends one immutable canonical event and replays deterministically", () => {
  const trust = {
    trustedIssuerIds: ["approved-clearing-source"],
    verifyAttestation: receipt => receipt.attestation.signature === "cryptographically-verified-test-signature"
  };
  const ledger = createPaperDemoEventLedger(opening, trust);
  const receipt = {
    schemaVersion: "1.0.0", kind: "FUTURES_MARGIN_RESERVATION", action: "RESERVE",
    receiptId: "settle-future-001", eventReference: "provider-event-001",
    accountId: opening.accountId, sessionId: opening.sessionId, orderId: "future-order-001",
    assetClass: "FUTURE", side: "BUY", currency: "INR",
    issuerId: "approved-clearing-source", sourceReference: "provider-source-001",
    policyVersion: "margin-policy-test-v1", issuedAt: "2026-11-25T09:30:00+05:30",
    amounts: { marginPaise: 25000, cashDeltaPaise: 0, blockedDeltaPaise: 25000 },
    attestation: { keyId: "test-key-1", signature: "cryptographically-verified-test-signature" }
  };
  seedFuturesOrder(ledger, receipt.orderId, "BUY");
  const scope = { orderId: receipt.orderId, assetClass: "FUTURE", side: "BUY" };
  const first = ledger.appendSettlementReceipt(receipt, scope);
  assert.equal(first.accepted, true);
  assert.equal(first.snapshot.events.length, 2);
  assert.equal(first.snapshot.events[1].type, "SETTLEMENT_RECEIPT_ACCEPTED");
  assert.equal(first.snapshot.events[1].engine, "FUTURES");
  assert.equal(first.snapshot.account.cashBalancePaise, opening.cashBalancePaise);
  assert.equal(first.snapshot.account.blockedFundsPaise, 25000);
  assert.equal(first.snapshot.account.ledgerReconciled, false);
  assert.equal(Object.isFrozen(first.snapshot.events[1].payload.receipt.amounts), true);

  const duplicate = ledger.appendSettlementReceipt(receipt, scope);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.snapshot.events.length, 2);
  assert.throws(() => ledger.appendSettlementReceipt({
    ...receipt, amounts: { ...receipt.amounts, blockedDeltaPaise: 24000 }
  }, scope), /SETTLEMENT_RECEIPT_REPLAY_MISMATCH/);

  assert.throws(() => replayPaperDemoEvents(opening, first.snapshot.events), /SETTLEMENT_ATTESTATION_VERIFIER_REQUIRED/);
  const replayed = replayPaperDemoEvents(opening, first.snapshot.events, trust);
  assert.deepEqual(replayed, first.snapshot);
});
test("canonical settlement append rejects reused provider event references and untrusted receipts", () => {
  const trust = {
    trustedIssuerIds: ["approved-clearing-source"],
    verifyAttestation: receipt => receipt.attestation.signature === "cryptographically-verified-test-signature"
  };
  const ledger = createPaperDemoEventLedger(opening, trust);
  const receipt = {
    schemaVersion: "1.0.0", kind: "FUTURES_MARGIN_RESERVATION", action: "RESERVE",
    receiptId: "settle-future-002", eventReference: "provider-event-002",
    accountId: opening.accountId, sessionId: opening.sessionId, orderId: "future-order-002",
    assetClass: "FUTURE", side: "BUY", currency: "INR",
    issuerId: "approved-clearing-source", sourceReference: "provider-source-002",
    policyVersion: "margin-policy-test-v1", issuedAt: "2026-11-25T09:30:00+05:30",
    amounts: { marginPaise: 25000, cashDeltaPaise: 0, blockedDeltaPaise: 25000 },
    attestation: { keyId: "test-key-1", signature: "cryptographically-verified-test-signature" }
  };
  seedFuturesOrder(ledger, receipt.orderId, "BUY");
  ledger.appendSettlementReceipt(receipt, { orderId: receipt.orderId, assetClass: "FUTURE", side: "BUY" });
  assert.throws(() => ledger.appendSettlementReceipt({
    ...receipt, receiptId: "settle-future-003"
  }, { orderId: receipt.orderId, assetClass: "FUTURE", side: "BUY" }), /SETTLEMENT_EVENT_REPLAY/);
  const noTrustLedger = createPaperDemoEventLedger(opening);
  seedFuturesOrder(noTrustLedger, receipt.orderId, "BUY");
  assert.throws(() => noTrustLedger.appendSettlementReceipt(
    receipt, { orderId: receipt.orderId, assetClass: "FUTURE", side: "BUY" }
  ), /SETTLEMENT_ATTESTATION_VERIFIER_REQUIRED/);
});
test("canonical ledger rejects a settlement receipt whose account/session scope is stale", () => {
  const ledger = createPaperDemoEventLedger(opening, {
    trustedIssuerIds: ["approved-clearing-source"],
    verifyAttestation: () => true
  });
  const receipt = {
    schemaVersion: "1.0.0", kind: "FUTURES_MARGIN_RESERVATION", action: "RESERVE",
    receiptId: "settle-future-004", eventReference: "provider-event-004",
    accountId: "mock-other-account", sessionId: opening.sessionId, orderId: "future-order-004",
    assetClass: "FUTURE", side: "BUY", currency: "INR",
    issuerId: "approved-clearing-source", sourceReference: "provider-source-004",
    policyVersion: "margin-policy-test-v1", issuedAt: "2026-11-25T09:30:00+05:30",
    amounts: { marginPaise: 25000, cashDeltaPaise: 0, blockedDeltaPaise: 25000 },
    attestation: { keyId: "test-key-1", signature: "cryptographically-verified-test-signature" }
  };
  seedFuturesOrder(ledger, receipt.orderId, "BUY");
  assert.throws(() => ledger.appendSettlementReceipt(
    receipt, { orderId: receipt.orderId, assetClass: "FUTURE", side: "BUY" }
  ), /SETTLEMENT_RECEIPT_SCOPE_MISMATCH/);
  assert.equal(ledger.snapshot().events.length, 1);
});

test("authoritative Options fill settlement applies premium and charges as one canonical cash event", () => {
  const trust = {
    trustedIssuerIds: ["approved-clearing-source"],
    verifyAttestation: receipt => receipt.attestation.signature === "cryptographically-verified-test-signature"
  };
  const ledger = createPaperDemoEventLedger(opening, trust);
  const receipt = {
    schemaVersion: "1.0.0", kind: "OPTIONS_FILL_SETTLEMENT", action: "SETTLE",
    receiptId: "settle-option-001", eventReference: "provider-option-event-001",
    fillId: "option-order-001-fill-001",
    accountId: opening.accountId, sessionId: opening.sessionId, orderId: "option-order-001",
    assetClass: "OPTION", side: "BUY", currency: "INR",
    issuerId: "approved-clearing-source", sourceReference: "provider-option-source-001",
    policyVersion: "options-policy-test-v1", issuedAt: "2026-11-25T09:30:00+05:30",
    amounts: { premiumCashDeltaPaise: -100000, chargesCashDeltaPaise: -1250, cashDeltaPaise: -101250, blockedDeltaPaise: 0 },
    attestation: { keyId: "test-key-1", signature: "cryptographically-verified-test-signature" }
  };
  seedOptionsFill(ledger, receipt.orderId, receipt.fillId, "BUY");
  const result = ledger.appendSettlementReceipt(receipt, {
    orderId: receipt.orderId, fillId: receipt.fillId, assetClass: "OPTION", side: "BUY"
  });
  assert.equal(result.accepted, true);
  assert.equal(result.snapshot.events[0].engine, "OPTIONS");
  assert.equal(result.snapshot.account.cashBalancePaise, opening.cashBalancePaise - 101250);
  assert.equal(result.snapshot.account.blockedFundsPaise, opening.blockedFundsPaise);
  assert.equal(result.snapshot.account.availableFundsPaise, opening.cashBalancePaise - 101250);
  assert.equal(result.snapshot.events[2].payload.receipt.amounts.chargesCashDeltaPaise, -1250);
});

test("generic append cannot inject an unverified settlement event or move account funds", () => {
  const ledger = createPaperDemoEventLedger(opening, {
    trustedIssuerIds: ["approved-clearing-source"],
    verifyAttestation: () => true
  });
  const before = ledger.snapshot();
  assert.throws(() => ledger.append(event({
    eventId: "forged-settlement-event",
    idempotencyKey: "forged-settlement-idempotency",
    sourceEventId: "forged-provider-event",
    engine: "OPTIONS",
    type: "SETTLEMENT_RECEIPT_ACCEPTED",
    deltas: { cashDeltaPaise: -500000, blockedDeltaPaise: 0 },
    payload: {
      receiptId: "forged-receipt",
      eventReference: "forged-provider-reference",
      orderId: "unverified-order",
      assetClass: "OPTION",
      receipt: {
        receiptId: "forged-receipt",
        eventReference: "forged-provider-reference",
        amounts: { cashDeltaPaise: -500000, blockedDeltaPaise: 0 }
      }
    }
  })), /SETTLEMENT_REQUIRES_VERIFIED_RECEIPT_PATH/);
  const after = ledger.snapshot();
  assert.deepEqual(after, before);
  assert.equal(after.account.cashBalancePaise, opening.cashBalancePaise);
  assert.equal(after.account.blockedFundsPaise, opening.blockedFundsPaise);
  assert.equal(after.account.ledgerReconciled, false);
});

test("Futures margin release cannot exceed the outstanding verified reservation for its order", () => {
  const trust = {
    trustedIssuerIds: ["approved-clearing-source"],
    verifyAttestation: receipt => receipt.attestation.signature === "cryptographically-verified-test-signature"
  };
  const ledger = createPaperDemoEventLedger(opening, trust);
  const base = {
    schemaVersion: "1.0.0", kind: "FUTURES_MARGIN_RESERVATION", action: "RESERVE",
    receiptId: "future-reserve-release-1", eventReference: "future-provider-reserve-1",
    accountId: opening.accountId, sessionId: opening.sessionId, orderId: "future-reserve-release-order",
    assetClass: "FUTURE", side: "BUY", currency: "INR",
    issuerId: "approved-clearing-source", sourceReference: "future-source-1",
    policyVersion: "margin-policy-test-v1", issuedAt: "2026-11-25T09:30:00+05:30",
    amounts: { marginPaise: 25000, cashDeltaPaise: 0, blockedDeltaPaise: 25000 },
    attestation: { keyId: "test-key-1", signature: "cryptographically-verified-test-signature" }
  };
  seedFuturesOrder(ledger, base.orderId, "BUY");
  ledger.appendSettlementReceipt(base, { orderId: base.orderId, assetClass: "FUTURE", side: "BUY" });
  const release = {
    ...base, action: "RELEASE", receiptId: "future-release-too-large",
    eventReference: "future-provider-release-too-large",
    sourceReference: "future-source-release-too-large",
    issuedAt: "2026-11-25T09:31:00+05:30",
    amounts: { marginPaise: 30000, cashDeltaPaise: 0, blockedDeltaPaise: -30000 }
  };
  assert.throws(() => ledger.appendSettlementReceipt(release, {
    orderId: base.orderId, assetClass: "FUTURE", side: "BUY"
  }), /FUTURES_MARGIN_RELEASE_EXCEEDS_OUTSTANDING_RESERVATION/);
  assert.equal(ledger.snapshot().account.blockedFundsPaise, 25000);
  assert.equal(ledger.snapshot().events.length, 2);
});

test("Options settlement rejects orphan fills, mismatched order ownership and wrong premium direction", () => {
  const trust = {
    trustedIssuerIds: ["approved-clearing-source"],
    verifyAttestation: () => true
  };
  const ledger = createPaperDemoEventLedger(opening, trust);
  const receipt = {
    schemaVersion: "1.0.0", kind: "OPTIONS_FILL_SETTLEMENT", action: "SETTLE",
    receiptId: "option-bound-fill-1", eventReference: "option-provider-fill-1",
    fillId: "option-bound-fill-id", accountId: opening.accountId,
    sessionId: opening.sessionId, orderId: "option-bound-order",
    assetClass: "OPTION", side: "BUY", currency: "INR",
    issuerId: "approved-clearing-source", sourceReference: "option-source-1",
    policyVersion: "options-policy-test-v1", issuedAt: "2026-11-25T09:30:00+05:30",
    amounts: { premiumCashDeltaPaise: -100000, chargesCashDeltaPaise: -100, cashDeltaPaise: -100100, blockedDeltaPaise: 0 },
    attestation: { keyId: "test-key-1", signature: "verified-test-signature" }
  };
  seedOptionsFill(ledger, receipt.orderId, receipt.fillId, "BUY");
  assert.throws(() => ledger.appendSettlementReceipt({
    ...receipt, fillId: "orphan-fill"
  }, { orderId: receipt.orderId, fillId: "orphan-fill", assetClass: "OPTION", side: "BUY" }),
  /SETTLEMENT_FILL_NOT_FOUND_OR_MISMATCH/);
  assert.throws(() => ledger.appendSettlementReceipt({
    ...receipt, amounts: { ...receipt.amounts, premiumCashDeltaPaise: 100000, cashDeltaPaise: 99900 }
  }, { orderId: receipt.orderId, fillId: receipt.fillId, assetClass: "OPTION", side: "BUY" }),
  /OPTIONS_PREMIUM_DIRECTION_MISMATCH/);
  assert.equal(ledger.snapshot().account.cashBalancePaise, opening.cashBalancePaise);
});


test("Options fill can be settled only once even when a provider sends a new receipt ID", () => {
  const trust = {
    trustedIssuerIds: ["approved-clearing-source"],
    verifyAttestation: () => true
  };
  const ledger = createPaperDemoEventLedger(opening, trust);
  const orderId = "option-once-order";
  const fillId = "option-once-fill";
  seedOptionsFill(ledger, orderId, fillId, "BUY");
  const receipt = {
    schemaVersion: "1.0.0", kind: "OPTIONS_FILL_SETTLEMENT", action: "SETTLE",
    receiptId: "option-once-receipt-1", eventReference: "option-once-event-1",
    fillId, accountId: opening.accountId, sessionId: opening.sessionId, orderId,
    assetClass: "OPTION", side: "BUY", currency: "INR",
    issuerId: "approved-clearing-source", sourceReference: "option-once-source-1",
    policyVersion: "options-policy-test-v1", issuedAt: "2026-11-25T09:30:00+05:30",
    amounts: { premiumCashDeltaPaise: -100000, chargesCashDeltaPaise: -100, cashDeltaPaise: -100100, blockedDeltaPaise: 0 },
    attestation: { keyId: "test-key-1", signature: "verified-test-signature" }
  };
  const first = ledger.appendSettlementReceipt(receipt, {
    orderId, fillId, assetClass: "OPTION", side: "BUY"
  });
  assert.equal(first.accepted, true);
  const before = ledger.snapshot();
  assert.throws(() => ledger.appendSettlementReceipt({
    ...receipt,
    receiptId: "option-once-receipt-2",
    eventReference: "option-once-event-2",
    sourceReference: "option-once-source-2"
  }, { orderId, fillId, assetClass: "OPTION", side: "BUY" }), /OPTIONS_FILL_ALREADY_SETTLED/);
  assert.deepEqual(ledger.snapshot(), before);
});

test("Futures reservation cannot be added after an order reaches a terminal state", () => {
  const trust = {
    trustedIssuerIds: ["approved-clearing-source"],
    verifyAttestation: () => true
  };
  const ledger = createPaperDemoEventLedger(opening, trust);
  const orderId = "future-terminal-reserve-order";
  seedFuturesOrder(ledger, orderId, "BUY");
  ledger.append(event({
    eventId: "terminal-" + orderId, idempotencyKey: "terminal-idem-" + orderId,
    sourceEventId: "terminal-source-" + orderId, occurredAt: "2026-11-25T09:30:00+05:30",
    engine: "FUTURES", type: "ORDER_UPDATED",
    deltas: { cashDeltaPaise: 0, blockedDeltaPaise: 0 },
    payload: { orderId, assetClass: "FUTURE", instrumentKey: "MOCK|NSE|FUT|NIFTY-2026-11", side: "BUY", orderType: "LIMIT", quantity: 1, status: "CANCELLED" }
  }));
  const receipt = {
    schemaVersion: "1.0.0", kind: "FUTURES_MARGIN_RESERVATION", action: "RESERVE",
    receiptId: "future-terminal-reserve-receipt", eventReference: "future-terminal-reserve-event",
    accountId: opening.accountId, sessionId: opening.sessionId, orderId,
    assetClass: "FUTURE", side: "BUY", currency: "INR",
    issuerId: "approved-clearing-source", sourceReference: "future-terminal-reserve-source",
    policyVersion: "margin-policy-test-v1", issuedAt: "2026-11-25T09:31:00+05:30",
    amounts: { marginPaise: 25000, cashDeltaPaise: 0, blockedDeltaPaise: 25000 },
    attestation: { keyId: "test-key-1", signature: "verified-test-signature" }
  };
  const before = ledger.snapshot();
  assert.throws(() => ledger.appendSettlementReceipt(receipt, {
    orderId, assetClass: "FUTURE", side: "BUY"
  }), /FUTURES_RESERVATION_ON_TERMINAL_ORDER/);
  assert.deepEqual(ledger.snapshot(), before);
});
