import test from "node:test";
import assert from "node:assert/strict";
import { validateAuthoritativeDemoSettlementReceipt as validate } from "../../markets/shared/paper-demo-settlement-receipt.mjs";

const context = {
  accountId: "mock-account-1", sessionId: "demo-session-1",
  orderId: "MOCK-FO-000001", assetClass: "FUTURE", side: "BUY",
  trustedIssuerIds: ["approved-clearing-source"],
  verifyAttestation: receipt => receipt.attestation.signature === "cryptographically-verified-test-signature"
};
const futureReceipt = overrides => ({
  schemaVersion: "1.0.0", kind: "FUTURES_MARGIN_RESERVATION", action: "RESERVE",
  receiptId: "receipt-future-1", eventReference: "event-future-1",
  accountId: context.accountId, sessionId: context.sessionId, orderId: context.orderId,
  assetClass: "FUTURE", side: "BUY", currency: "INR",
  issuerId: "approved-clearing-source", sourceReference: "source-record-1",
  policyVersion: "margin-policy-2026-11", issuedAt: "2026-11-25T10:00:00+05:30",
  amounts: { marginPaise: 250000, cashDeltaPaise: 0, blockedDeltaPaise: 250000 },
  attestation: { keyId: "test-key-1", signature: "cryptographically-verified-test-signature" },
  ...overrides
});

test("accepts Futures margin only with trusted issuer and verified attestation", () => {
  const result = validate(futureReceipt(), context);
  assert.equal(result.accepted, true);
  assert.equal(result.receipt.amounts.blockedDeltaPaise, 250000);
});
test("fails closed when verifier or trusted issuer allowlist is missing", () => {
  assert.throws(() => validate(futureReceipt(), { ...context, verifyAttestation: undefined }), /SETTLEMENT_ATTESTATION_VERIFIER_REQUIRED/);
  assert.throws(() => validate(futureReceipt(), { ...context, trustedIssuerIds: [] }), /SETTLEMENT_TRUSTED_ISSUER_ALLOWLIST_REQUIRED/);
});
test("rejects untrusted issuer, invalid signature and account/session/order mismatch", () => {
  assert.throws(() => validate(futureReceipt({ issuerId: "unknown-source" }), context), /SETTLEMENT_ISSUER_NOT_TRUSTED/);
  assert.throws(() => validate(futureReceipt({ attestation: { keyId: "key", signature: "forged-signature-value" } }), context), /SETTLEMENT_ATTESTATION_INVALID/);
  assert.throws(() => validate(futureReceipt({ accountId: "mock-other-account" }), context), /SETTLEMENT_RECEIPT_SCOPE_MISMATCH/);
});
test("rejects guessed or internally inconsistent Futures margin deltas", () => {
  assert.throws(() => validate(futureReceipt({ amounts: { marginPaise: 250000, cashDeltaPaise: -250000, blockedDeltaPaise: 250000 } }), context), /INVALID_FUTURES_MARGIN_RECEIPT/);
  assert.throws(() => validate(futureReceipt({ amounts: { marginPaise: 250000, cashDeltaPaise: 0, blockedDeltaPaise: -250000 } }), context), /FUTURES_MARGIN_DELTA_DIRECTION_MISMATCH/);
  assert.throws(() => validate(futureReceipt({ amounts: { marginPaise: 250000, cashDeltaPaise: 0, blockedDeltaPaise: 300000 } }), context), /FUTURES_MARGIN_DELTA_OUT_OF_RANGE/);
});
test("accepts Options settlement only when authoritative cash components add exactly", () => {
  const receipt = {
    schemaVersion: "1.0.0", kind: "OPTIONS_FILL_SETTLEMENT", action: "SETTLE",
    receiptId: "receipt-option-1", eventReference: "event-option-1",
    fillId: "MOCK-FO-000002-F001", accountId: context.accountId,
    sessionId: context.sessionId, orderId: context.orderId,
    assetClass: "OPTION", side: "BUY", currency: "INR",
    issuerId: "approved-clearing-source", sourceReference: "source-option-1",
    policyVersion: "options-settlement-2026-11", issuedAt: "2026-11-25T10:00:00+05:30",
    amounts: { premiumCashDeltaPaise: -100000, chargesCashDeltaPaise: -1250, cashDeltaPaise: -101250, blockedDeltaPaise: 0 },
    attestation: { keyId: "test-key-1", signature: "cryptographically-verified-test-signature" }
  };
  const result = validate(receipt, { ...context, assetClass: "OPTION", fillId: receipt.fillId });
  assert.equal(result.accepted, true);
  assert.equal(result.receipt.amounts.cashDeltaPaise, -101250);
});
test("rejects Options receipts with missing fill identity or mismatched cash components", () => {
  const receipt = {
    schemaVersion: "1.0.0", kind: "OPTIONS_FILL_SETTLEMENT", action: "SETTLE",
    receiptId: "receipt-option-2", eventReference: "event-option-2",
    fillId: "MOCK-FO-000002-F001", accountId: context.accountId,
    sessionId: context.sessionId, orderId: context.orderId,
    assetClass: "OPTION", side: "BUY", currency: "INR",
    issuerId: "approved-clearing-source", sourceReference: "source-option-2",
    policyVersion: "options-settlement-2026-11", issuedAt: "2026-11-25T10:00:00+05:30",
    amounts: { premiumCashDeltaPaise: -100000, chargesCashDeltaPaise: -1250, cashDeltaPaise: -100000, blockedDeltaPaise: 0 },
    attestation: { keyId: "test-key-1", signature: "cryptographically-verified-test-signature" }
  };
  const optionsContext = { ...context, assetClass: "OPTION", fillId: receipt.fillId };
  assert.throws(() => validate(receipt, optionsContext), /OPTIONS_SETTLEMENT_COMPONENTS_DO_NOT_RECONCILE/);
  assert.throws(() => validate(receipt, { ...optionsContext, fillId: undefined }), /INVALID_OPTIONS_SETTLEMENT_RECEIPT/);
});
test("receipt validation does not derive margin, premium, fees or exchange charges", () => {
  const receipt = futureReceipt();
  const result = validate(receipt, context);
  assert.deepEqual(result.receipt.amounts, receipt.amounts);
  assert.equal("calculatedMarginPaise" in result.receipt, false);
  assert.equal("calculatedChargesPaise" in result.receipt, false);
});
