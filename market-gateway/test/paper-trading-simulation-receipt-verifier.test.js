"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { canonicalize, verifyPaperTradingSimulationReceipt } = require("../lib/paper-trading-simulation-receipt-verifier");

const now = Date.parse("2026-11-26T12:00:00.000Z");
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const keyRegistry = new Map([["zenura-internal-paper", new Map([["test-key-01", {
  algorithm: "Ed25519",
  environment: "test",
  publicKeyPem,
  notBefore: "2026-01-01T00:00:00.000Z",
  notAfter: "2027-01-01T00:00:00.000Z"
}]])]]);
const expectedAmounts = {
  quantity: 2,
  pricePaise: 12500,
  grossPaise: 25000,
  feesPaise: 70,
  taxesPaise: 20,
  otherChargesPaise: 10,
  netCashDeltaPaise: -25100,
  blockedDeltaPaise: 0
};
const expected = {
  environment: "test",
  accountId: "account-opaque-001",
  assetClass: "FUTURES",
  instrumentKey: "NSE|FUT|NIFTY|2026-12-31",
  side: "BUY",
  product: "CARRY_FORWARD",
  sourceSnapshotId: "quote-snapshot-001",
  orderId: "order-001",
  fillId: "fill-001",
  sourceTransactionId: "txn-001",
  transactionVersion: "v0001",
  amounts: expectedAmounts
};
function payload(overrides = {}) {
  return {
    receiptType: "PAPER_TRADING_SIMULATION",
    schemaVersion: "1.0.0",
    environment: "test",
    issuerId: "zenura-internal-paper",
    keyId: "test-key-01",
    algorithm: "Ed25519",
    receiptId: "receipt-001",
    idempotencyKey: "idem-001",
    sourceTransactionId: "txn-001",
    accountId: "account-opaque-001",
    assetClass: "FUTURES",
    instrumentKey: "NSE|FUT|NIFTY|2026-12-31",
    side: "BUY",
    product: "CARRY_FORWARD",
    sourceSnapshotId: "quote-snapshot-001",
    orderId: "order-001",
    fillId: "fill-001",
    transactionVersion: "v0001",
    currency: "INR",
    simulationOnly: true,
    amounts: { ...expectedAmounts },
    occurredAt: "2026-11-26T11:59:00.000Z",
    committedAt: "2026-11-26T11:59:01.000Z",
    issuedAt: "2026-11-26T11:59:02.000Z",
    ...overrides
  };
}
function signedReceipt(p = payload(), signingKey = privateKey) {
  const signature = crypto.sign(null, Buffer.from(canonicalize(p), "utf8"), signingKey).toString("base64url");
  return { payload: p, signature };
}
function verify(receipt, options = {}) {
  return verifyPaperTradingSimulationReceipt({
    receipt,
    keyRegistry,
    expected,
    now,
    ...options
  });
}

test("verifies an Ed25519 signature over canonical payload bytes and binds the committed transaction", () => {
  const result = verify(signedReceipt());
  assert.equal(result.verified, true);
  assert.equal(result.simulationOnly, true);
  assert.equal(result.accountingPostingAuthorized, false);
  assert.equal(result.replayProtection, "REQUIRES_DURABLE_DATABASE_UNIQUE_CONSTRAINTS");
  assert.match(result.payloadSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.receiptId, "receipt-001");
});
test("canonicalization is stable across object key insertion order", () => {
  assert.equal(canonicalize({ z: 1, a: { y: 2, x: 3 } }), canonicalize({ a: { x: 3, y: 2 }, z: 1 }));
});
test("rejects a payload altered after signing", () => {
  const receipt = signedReceipt();
  receipt.payload.amounts.netCashDeltaPaise = -1;
  assert.throws(() => verify(receipt), /RECEIPT_SIGNATURE_INVALID/);
});
test("rejects cross-account, order, fill, asset, source-transaction and environment substitution", () => {
  for (const [field, value] of [
    ["accountId", "account-other"], ["orderId", "order-other"], ["fillId", "fill-other"],
    ["assetClass", "OPTIONS"], ["instrumentKey", "NSE|FUT|BANKNIFTY|2026-12-31"],
    ["side", "SELL"], ["product", "INTRADAY"], ["sourceSnapshotId", "quote-snapshot-other"],
    ["sourceTransactionId", "txn-other"], ["environment", "production"]
  ]) {
    const p = payload({ [field]: value });
    assert.throws(() => verify(signedReceipt(p)), new RegExp("RECEIPT_TRANSACTION_BINDING_MISMATCH:" + field));
  }
});
test("rejects receipt amounts or transaction version that differ from the committed database facts", () => {
  assert.throws(() => verify(signedReceipt(payload({
    amounts: { ...expectedAmounts, netCashDeltaPaise: -1 }
  }))), /RECEIPT_COMMITTED_AMOUNT_BINDING_MISMATCH/);
  assert.throws(() => verify(signedReceipt(payload({ transactionVersion: "v0002" }))), /RECEIPT_TRANSACTION_BINDING_MISMATCH:transactionVersion/);
});
test("rejects unknown issuer and key", () => {
  assert.throws(() => verify(signedReceipt(payload({ issuerId: "unknown-issuer" }))), /RECEIPT_ISSUER_NOT_TRUSTED/);
  assert.throws(() => verify(signedReceipt(payload({ keyId: "unknown-key" }))), /RECEIPT_KEY_NOT_TRUSTED/);
});
test("rejects a key outside its validity window or revoked for current verification", () => {
  const expiredRegistry = new Map([["zenura-internal-paper", new Map([["test-key-01", {
    algorithm: "Ed25519", environment: "test", publicKeyPem,
    notBefore: "2025-01-01T00:00:00.000Z", notAfter: "2026-11-01T00:00:00.000Z"
  }]])]]);
  assert.throws(() => verify(signedReceipt(), { keyRegistry: expiredRegistry }), /RECEIPT_KEY_OUTSIDE_VALIDITY/);
  const revokedRegistry = new Map([["zenura-internal-paper", new Map([["test-key-01", {
    algorithm: "Ed25519", environment: "test", publicKeyPem,
    notBefore: "2026-01-01T00:00:00.000Z", notAfter: "2027-01-01T00:00:00.000Z",
    revokedAt: "2026-11-26T11:00:00.000Z"
  }]])]]);
  assert.throws(() => verify(signedReceipt(), { keyRegistry: revokedRegistry }), /RECEIPT_KEY_REVOKED/);
});
test("rejects private key material in the verifier trust registry", () => {
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const unsafeRegistry = new Map([["zenura-internal-paper", new Map([["test-key-01", {
    algorithm: "Ed25519", environment: "test", publicKeyPem: privateKeyPem,
    notBefore: "2026-01-01T00:00:00.000Z", notAfter: "2027-01-01T00:00:00.000Z"
  }]])]]);
  assert.throws(() => verify(signedReceipt(), { keyRegistry: unsafeRegistry }), /RECEIPT_PUBLIC_KEY_MUST_BE_PUBLIC_ONLY/);
});
test("rejects algorithm and environment key-registry confusion", () => {
  assert.throws(() => verify(signedReceipt(payload({ algorithm: "RS256" }))), /RECEIPT_ALGORITHM_UNSUPPORTED/);
  const wrongEnvRegistry = new Map([["zenura-internal-paper", new Map([["test-key-01", {
    algorithm: "Ed25519", environment: "production", publicKeyPem,
    notBefore: "2026-01-01T00:00:00.000Z", notAfter: "2027-01-01T00:00:00.000Z"
  }]])]]);
  assert.throws(() => verify(signedReceipt(), { keyRegistry: wrongEnvRegistry }), /RECEIPT_KEY_SCOPE_MISMATCH/);
});
test("rejects unknown signed payload and amount fields", () => {
  assert.throws(() => verify(signedReceipt(payload({ unreviewedFlag: true }))), /RECEIPT_UNKNOWN_PAYLOAD_FIELD/);
  assert.throws(() => verify(signedReceipt(payload({
    amounts: { ...payload().amounts, hiddenAdjustmentPaise: 1 }
  }))), /RECEIPT_UNKNOWN_AMOUNT_FIELD/);
});
test("rejects unsafe monetary numbers, non-INR and non-simulation receipts", () => {
  assert.throws(() => canonicalize(payload({ amounts: { ...payload().amounts, grossPaise: Number.MAX_SAFE_INTEGER + 1 } })), /RECEIPT_NON_INTEGER_NUMBER/);
  assert.throws(() => verify(signedReceipt(payload({ currency: "USD" }))), /RECEIPT_NOT_EXPLICITLY_SIMULATED_INR/);
  assert.throws(() => verify(signedReceipt(payload({ simulationOnly: false }))), /RECEIPT_NOT_EXPLICITLY_SIMULATED_INR/);
});
test("rejects malformed signatures and future/expired receipt timestamps", () => {
  assert.throws(() => verify({ payload: payload(), signature: "not*base64" }), /RECEIPT_SIGNATURE_REQUIRED/);
  assert.throws(() => verify(signedReceipt(payload({ issuedAt: "2026-11-26T12:01:00.000Z" }))), /RECEIPT_ISSUED_IN_FUTURE/);
  assert.throws(() => verify(signedReceipt(payload({ expiresAt: "2026-11-26T11:58:00.000Z" }))), /RECEIPT_EXPIRY_INVALID/);
});
test("requires a server-owned Map trust registry and exact expected transaction bindings", () => {
  assert.throws(() => verify(signedReceipt(), { keyRegistry: {} }), /RECEIPT_TRUST_REGISTRY_REQUIRED/);
  assert.throws(() => verify(signedReceipt(), { expected: { ...expected, fillId: undefined } }), /RECEIPT_TRANSACTION_BINDING_MISMATCH:fillId/);
});

test("rejects impossible calendar dates and out-of-range wall-clock components", () => {
  for (const occurredAt of [
    "2026-02-30T11:59:00.000Z",
    "2026-13-01T11:59:00.000Z",
    "2026-04-31T11:59:00.000Z",
    "2026-11-26T24:00:00.000Z",
    "2026-11-26T12:60:00.000Z",
    "2026-11-26T12:00:60.000Z",
    "2026-11-26T12:00:00+24:00",
    "2026-11-26T12:00:00+05:60"
  ]) {
    assert.throws(() => verify(signedReceipt(payload({ occurredAt }))), /RECEIPT_OCCURRED_AT_INVALID/);
  }
});

test("accepts valid leap-day and offset timestamps", () => {
  const valid = signedReceipt(payload({ occurredAt: "2024-02-29T23:59:59.999+05:30" }));
  assert.equal(verify(valid).verified, true);
});
