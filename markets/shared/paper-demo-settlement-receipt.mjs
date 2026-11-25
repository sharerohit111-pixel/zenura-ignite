const fail = code => { throw new TypeError(code); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const safeInteger = value => Number.isSafeInteger(value);
const identity = (value, code) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) fail(code);
};
const clone = value => JSON.parse(JSON.stringify(value));
const deepFreeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};
const contains = (collection, value) => collection instanceof Set
  ? collection.has(value)
  : Array.isArray(collection) && collection.includes(value);

/**
 * Validate a provider-attested Demo F&O accounting fact.
 * This module never calculates margin, premium, brokerage, taxes, or exchange
 * charges. A trusted issuer allowlist and a synchronous attestation verifier
 * are mandatory. Caller-supplied "verified" flags are not accepted as proof.
 */
export function validateAuthoritativeDemoSettlementReceipt(
  receipt,
  { accountId, sessionId, orderId, fillId, assetClass, side, trustedIssuerIds, verifyAttestation, consumedReceiptIds = [], consumedEventReferences = [] } = {}
) {
  if (!object(receipt)) fail("SETTLEMENT_RECEIPT_REQUIRED");
  if (typeof verifyAttestation !== "function") fail("SETTLEMENT_ATTESTATION_VERIFIER_REQUIRED");
  if (!Array.isArray(trustedIssuerIds) || trustedIssuerIds.length === 0 ||
      trustedIssuerIds.some(value => typeof value !== "string" || value.trim() === "")) {
    fail("SETTLEMENT_TRUSTED_ISSUER_ALLOWLIST_REQUIRED");
  }
  for (const collection of [consumedReceiptIds, consumedEventReferences]) {
    if (!(collection instanceof Set) && !Array.isArray(collection)) {
      fail("SETTLEMENT_REPLAY_INDEX_INVALID");
    }
  }
  for (const [value, code] of [
    [accountId, "EXPECTED_ACCOUNT_REQUIRED"], [sessionId, "EXPECTED_SESSION_REQUIRED"],
    [orderId, "EXPECTED_ORDER_REQUIRED"], [assetClass, "EXPECTED_ASSET_REQUIRED"], [side, "EXPECTED_SIDE_REQUIRED"]
  ]) identity(value, code);
  if (!["FUTURE", "OPTION"].includes(assetClass) || !["BUY", "SELL"].includes(side)) {
    fail("INVALID_EXPECTED_SETTLEMENT_SCOPE");
  }
  if (receipt.schemaVersion !== "1.0.0" || receipt.currency !== "INR" ||
      receipt.accountId !== accountId || receipt.sessionId !== sessionId ||
      receipt.orderId !== orderId || receipt.assetClass !== assetClass || receipt.side !== side) {
    fail("SETTLEMENT_RECEIPT_SCOPE_MISMATCH");
  }
  identity(receipt.receiptId, "INVALID_SETTLEMENT_RECEIPT_ID");
  identity(receipt.eventReference, "INVALID_SETTLEMENT_EVENT_REFERENCE");
  if (contains(consumedReceiptIds, receipt.receiptId)) fail("SETTLEMENT_RECEIPT_REPLAY");
  if (contains(consumedEventReferences, receipt.eventReference)) fail("SETTLEMENT_EVENT_REPLAY");
  identity(receipt.issuerId, "INVALID_SETTLEMENT_ISSUER");
  identity(receipt.sourceReference, "INVALID_SETTLEMENT_SOURCE_REFERENCE");
  identity(receipt.policyVersion, "INVALID_SETTLEMENT_POLICY_VERSION");
  if (!trustedIssuerIds.includes(receipt.issuerId)) fail("SETTLEMENT_ISSUER_NOT_TRUSTED");
  if (typeof receipt.issuedAt !== "string" || !Number.isFinite(Date.parse(receipt.issuedAt))) {
    fail("INVALID_SETTLEMENT_ISSUED_AT");
  }
  if (!object(receipt.attestation) || typeof receipt.attestation.signature !== "string" ||
      receipt.attestation.signature.length < 16 || typeof receipt.attestation.keyId !== "string" ||
      receipt.attestation.keyId.length === 0) fail("SETTLEMENT_ATTESTATION_REQUIRED");
  let attested = false;
  try { attested = verifyAttestation(clone(receipt)) === true; }
  catch { attested = false; }
  if (!attested) fail("SETTLEMENT_ATTESTATION_INVALID");

  if (!object(receipt.amounts)) fail("SETTLEMENT_AMOUNTS_REQUIRED");
  const amounts = receipt.amounts;
  if (!safeInteger(amounts.cashDeltaPaise) || !safeInteger(amounts.blockedDeltaPaise)) {
    fail("INVALID_SETTLEMENT_LEDGER_DELTAS");
  }
  if (assetClass === "FUTURE") {
    if (receipt.kind !== "FUTURES_MARGIN_RESERVATION" ||
        !["RESERVE", "RELEASE"].includes(receipt.action) ||
        !safeInteger(amounts.marginPaise) || amounts.marginPaise <= 0 ||
        amounts.cashDeltaPaise !== 0) fail("INVALID_FUTURES_MARGIN_RECEIPT");
    if ((receipt.action === "RESERVE" && amounts.blockedDeltaPaise <= 0) ||
        (receipt.action === "RELEASE" && amounts.blockedDeltaPaise >= 0)) {
      fail("FUTURES_MARGIN_DELTA_DIRECTION_MISMATCH");
    }
    if (amounts.blockedDeltaPaise === 0 ||
        Math.abs(amounts.blockedDeltaPaise) > amounts.marginPaise) {
      fail("FUTURES_MARGIN_DELTA_OUT_OF_RANGE");
    }
  } else {
    if (receipt.kind !== "OPTIONS_FILL_SETTLEMENT" || receipt.action !== "SETTLE" ||
        typeof fillId !== "string" || receipt.fillId !== fillId ||
        (typeof fillId === "string" && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(fillId)) ||
        !safeInteger(amounts.premiumCashDeltaPaise) ||
        !safeInteger(amounts.chargesCashDeltaPaise)) {
      fail("INVALID_OPTIONS_SETTLEMENT_RECEIPT");
    }
    const total = amounts.premiumCashDeltaPaise + amounts.chargesCashDeltaPaise;
    if (!Number.isSafeInteger(total) || total !== amounts.cashDeltaPaise ||
        amounts.blockedDeltaPaise !== 0) {
      fail("OPTIONS_SETTLEMENT_COMPONENTS_DO_NOT_RECONCILE");
    }
  }
  return Object.freeze({ accepted: true, receipt: deepFreeze(clone(receipt)) });
}
