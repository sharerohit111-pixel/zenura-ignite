"use strict";

// Cryptographic verifier for INTERNAL Paper Trading simulation receipts.
// This module is deliberately not wired into any accounting RPC or balance path.
// It verifies a detached Ed25519 signature against a server-owned public-key registry.
// Durable replay prevention and key-registry provisioning remain external prerequisites.

const crypto = require("node:crypto");

const RECEIPT_TYPE = "PAPER_TRADING_SIMULATION";
const SCHEMA_VERSION = "1.0.0";
const ALGORITHM = "Ed25519";
const ENVIRONMENTS = new Set(["test", "staging", "production"]);
const ASSETS = new Set(["EQUITY", "FUTURES", "OPTIONS"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const fail = code => { throw new TypeError(code); };
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isSafeInteger = Number.isSafeInteger;

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) fail("RECEIPT_NON_INTEGER_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  if (isObject(value)) {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail("RECEIPT_NON_PLAIN_OBJECT");
    const keys = Object.keys(value).sort();
    return "{" + keys.map(key => {
      if (value[key] === undefined) fail("RECEIPT_UNDEFINED_FIELD");
      return JSON.stringify(key) + ":" + canonicalize(value[key]);
    }).join(",") + "}";
  }
  fail("RECEIPT_UNSUPPORTED_VALUE");
}

function timestamp(value, code) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    fail(code);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(code);
  return parsed;
}

function validatePayload(payload) {
  if (!isObject(payload) || Object.getPrototypeOf(payload) !== Object.prototype) fail("RECEIPT_PAYLOAD_REQUIRED");
  if (payload.receiptType !== RECEIPT_TYPE || payload.schemaVersion !== SCHEMA_VERSION) fail("RECEIPT_TYPE_OR_SCHEMA_UNSUPPORTED");
  if (!ENVIRONMENTS.has(payload.environment)) fail("RECEIPT_ENVIRONMENT_INVALID");
  if (payload.algorithm !== ALGORITHM) fail("RECEIPT_ALGORITHM_UNSUPPORTED");
  for (const field of ["issuerId", "keyId", "receiptId", "idempotencyKey", "sourceTransactionId", "accountId", "orderId", "fillId", "transactionVersion"]) {
    if (typeof payload[field] !== "string" || !ID.test(payload[field])) fail("RECEIPT_IDENTITY_INVALID:" + field);
  }
  if (!ASSETS.has(payload.assetClass)) fail("RECEIPT_ASSET_INVALID");
  if (payload.currency !== "INR" || payload.simulationOnly !== true) fail("RECEIPT_NOT_EXPLICITLY_SIMULATED_INR");
  if (!isObject(payload.amounts)) fail("RECEIPT_AMOUNTS_REQUIRED");
  const amountFields = ["quantity", "pricePaise", "grossPaise", "chargesPaise", "netCashDeltaPaise", "blockedDeltaPaise"];
  for (const field of amountFields) {
    if (!isSafeInteger(payload.amounts[field])) fail("RECEIPT_AMOUNT_INVALID:" + field);
  }
  if (payload.amounts.quantity <= 0 || payload.amounts.pricePaise < 0 ||
      payload.amounts.grossPaise < 0 || payload.amounts.chargesPaise < 0) {
    fail("RECEIPT_AMOUNT_OUT_OF_RANGE");
  }
  const occurredAt = timestamp(payload.occurredAt, "RECEIPT_OCCURRED_AT_INVALID");
  const committedAt = timestamp(payload.committedAt, "RECEIPT_COMMITTED_AT_INVALID");
  const issuedAt = timestamp(payload.issuedAt, "RECEIPT_ISSUED_AT_INVALID");
  if (committedAt < occurredAt || issuedAt < committedAt) fail("RECEIPT_TIMESTAMP_ORDER_INVALID");
  if (payload.expiresAt !== undefined && timestamp(payload.expiresAt, "RECEIPT_EXPIRES_AT_INVALID") <= issuedAt) {
    fail("RECEIPT_EXPIRY_INVALID");
  }
  return { occurredAt, committedAt, issuedAt };
}

function lookupKey(keyRegistry, issuerId, keyId) {
  if (!(keyRegistry instanceof Map)) fail("RECEIPT_TRUST_REGISTRY_REQUIRED");
  const issuerKeys = keyRegistry.get(issuerId);
  if (!(issuerKeys instanceof Map)) fail("RECEIPT_ISSUER_NOT_TRUSTED");
  const entry = issuerKeys.get(keyId);
  if (!isObject(entry)) fail("RECEIPT_KEY_NOT_TRUSTED");
  return entry;
}

/**
 * Verify an internal simulation receipt.
 *
 * receipt shape: { payload: <signed payload>, signature: <base64url Ed25519 signature> }
 * keyRegistry: server-owned Map(issuerId => Map(keyId => {
 *   algorithm: "Ed25519", environment, publicKeyPem, notBefore, notAfter, revokedAt?
 * }))
 * expected: exact trusted transaction context to bind (environment, accountId,
 * assetClass, orderId, fillId, sourceTransactionId).
 *
 * This function does not persist a replay index, issue receipts, or authorize postings.
 */
function verifyPaperTradingSimulationReceipt({ receipt, keyRegistry, expected, now = Date.now() } = {}) {
  if (!isObject(receipt) || !isObject(receipt.payload)) fail("RECEIPT_REQUIRED");
  if (typeof receipt.signature !== "string" || !BASE64URL.test(receipt.signature)) fail("RECEIPT_SIGNATURE_REQUIRED");
  if (!isSafeInteger(now) || now < 0) fail("RECEIPT_VERIFICATION_TIME_INVALID");
  if (!isObject(expected)) fail("RECEIPT_EXPECTED_BINDING_REQUIRED");

  const times = validatePayload(receipt.payload);
  const payload = receipt.payload;
  for (const field of ["environment", "accountId", "assetClass", "orderId", "fillId", "sourceTransactionId"]) {
    if (typeof expected[field] !== "string" || payload[field] !== expected[field]) {
      fail("RECEIPT_TRANSACTION_BINDING_MISMATCH:" + field);
    }
  }
  if (times.issuedAt > now) fail("RECEIPT_ISSUED_IN_FUTURE");
  if (payload.expiresAt !== undefined && timestamp(payload.expiresAt, "RECEIPT_EXPIRES_AT_INVALID") <= now) {
    fail("RECEIPT_EXPIRED");
  }

  const key = lookupKey(keyRegistry, payload.issuerId, payload.keyId);
  if (key.algorithm !== ALGORITHM || key.environment !== payload.environment) fail("RECEIPT_KEY_SCOPE_MISMATCH");
  const notBefore = timestamp(key.notBefore, "RECEIPT_KEY_NOT_BEFORE_INVALID");
  const notAfter = timestamp(key.notAfter, "RECEIPT_KEY_NOT_AFTER_INVALID");
  if (notAfter <= notBefore || times.issuedAt < notBefore || times.issuedAt > notAfter) fail("RECEIPT_KEY_OUTSIDE_VALIDITY");
  if (key.revokedAt !== undefined && timestamp(key.revokedAt, "RECEIPT_KEY_REVOCATION_INVALID") <= now) {
    fail("RECEIPT_KEY_REVOKED");
  }
  if (typeof key.publicKeyPem !== "string" || !key.publicKeyPem.trim()) fail("RECEIPT_PUBLIC_KEY_MISSING");

  let publicKey;
  try { publicKey = crypto.createPublicKey(key.publicKeyPem); }
  catch { fail("RECEIPT_PUBLIC_KEY_INVALID"); }
  if (publicKey.asymmetricKeyType !== "ed25519") fail("RECEIPT_PUBLIC_KEY_TYPE_MISMATCH");

  let signature;
  try { signature = Buffer.from(receipt.signature, "base64url"); }
  catch { fail("RECEIPT_SIGNATURE_ENCODING_INVALID"); }
  if (signature.length !== 64 || signature.toString("base64url") !== receipt.signature) {
    fail("RECEIPT_SIGNATURE_ENCODING_INVALID");
  }

  const signedBytes = Buffer.from(canonicalize(payload), "utf8");
  let verified = false;
  try { verified = crypto.verify(null, signedBytes, publicKey, signature); }
  catch { verified = false; }
  if (!verified) fail("RECEIPT_SIGNATURE_INVALID");

  return Object.freeze({
    verified: true,
    receiptType: RECEIPT_TYPE,
    simulationOnly: true,
    environment: payload.environment,
    issuerId: payload.issuerId,
    keyId: payload.keyId,
    receiptId: payload.receiptId,
    sourceTransactionId: payload.sourceTransactionId,
    accountId: payload.accountId,
    assetClass: payload.assetClass,
    orderId: payload.orderId,
    fillId: payload.fillId,
    transactionVersion: payload.transactionVersion,
    payloadSha256: crypto.createHash("sha256").update(signedBytes).digest("hex"),
    verifiedAt: new Date(now).toISOString(),
    accountingPostingAuthorized: false,
    replayProtection: "REQUIRES_DURABLE_DATABASE_UNIQUE_CONSTRAINTS"
  });
}

module.exports = { canonicalize, verifyPaperTradingSimulationReceipt };
