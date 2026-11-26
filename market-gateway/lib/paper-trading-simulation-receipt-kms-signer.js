"use strict";

// Google Cloud KMS Ed25519 signer adapter for internal simulation receipts.
// This module requires a server-created KMS client and an explicitly configured
// CryptoKeyVersion resource name. It never accepts or stores private key material.
// It is not wired into the Paper Trading transaction path.

const crypto = require("node:crypto");
const { canonicalize, validatePaperTradingSimulationReceiptPayload } = require("./paper-trading-simulation-receipt-verifier");

const ALGORITHM = "Ed25519";
const RECEIPT_TYPE = "PAPER_TRADING_SIMULATION";
const ENVIRONMENTS = new Set(["test", "staging", "production"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const fail = code => { throw new TypeError(code); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

function crc32c(data) {
  if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) fail("KMS_SIGNER_CHECKSUM_INPUT_INVALID");
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createGoogleCloudKmsEd25519Signer({
  client,
  keyVersionName,
  issuerId,
  keyId,
  environment
} = {}) {
  if (!object(client) || typeof client.asymmetricSign !== "function") fail("KMS_SIGNER_CLIENT_REQUIRED");
  if (typeof keyVersionName !== "string" ||
      !/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/[0-9]+$/.test(keyVersionName)) {
    fail("KMS_SIGNER_KEY_VERSION_NAME_INVALID");
  }
  if (typeof issuerId !== "string" || !ID.test(issuerId)) fail("KMS_SIGNER_ISSUER_INVALID");
  if (typeof keyId !== "string" || !ID.test(keyId)) fail("KMS_SIGNER_KEY_ID_INVALID");
  if (!ENVIRONMENTS.has(environment)) fail("KMS_SIGNER_ENVIRONMENT_INVALID");

  return Object.freeze({
    algorithm: ALGORITHM,
    issuerId,
    keyId,
    environment,
    async signPayload(payload) {
      if (!object(payload) || payload.receiptType !== RECEIPT_TYPE ||
          payload.issuerId !== issuerId || payload.keyId !== keyId ||
          payload.algorithm !== ALGORITHM || payload.environment !== environment) {
        fail("KMS_SIGNER_PAYLOAD_SCOPE_MISMATCH");
      }
      validatePaperTradingSimulationReceiptPayload(payload);
      const data = Buffer.from(canonicalize(payload), "utf8");
      if (data.length === 0 || data.length > 65536) fail("KMS_SIGNER_PAYLOAD_SIZE_INVALID");
      const dataCrc32c = crc32c(data);

      let response;
      try {
        // EC_SIGN_ED25519 is PureEdDSA: pass the canonical payload as raw data,
        // not a pre-hashed digest. KMS verifies the request checksum.
        [response] = await client.asymmetricSign({
          name: keyVersionName,
          data,
          dataCrc32c: { value: dataCrc32c }
        });
      } catch {
        fail("KMS_SIGNER_REQUEST_FAILED");
      }
      if (!object(response) || response.name !== keyVersionName ||
          response.verifiedDataCrc32c !== true) fail("KMS_SIGNER_REQUEST_INTEGRITY_FAILED");
      if (!response.signature || !response.signatureCrc32c ||
          response.signatureCrc32c.value === undefined) fail("KMS_SIGNER_RESPONSE_INTEGRITY_MISSING");

      const signature = Buffer.from(response.signature);
      const reportedCrc = Number(response.signatureCrc32c.value);
      if (signature.length !== 64 || !Number.isSafeInteger(reportedCrc) ||
          crc32c(signature) !== reportedCrc) fail("KMS_SIGNER_RESPONSE_INTEGRITY_FAILED");

      return Object.freeze({
        payload,
        signature: signature.toString("base64url"),
        algorithm: ALGORITHM,
        issuerId,
        keyId,
        keyVersionName,
        signedPayloadSha256: crypto.createHash("sha256").update(data).digest("hex")
      });
    }
  });
}

module.exports = { crc32c, createGoogleCloudKmsEd25519Signer };
