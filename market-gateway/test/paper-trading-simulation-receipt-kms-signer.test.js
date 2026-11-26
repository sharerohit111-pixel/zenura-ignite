"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { crc32c, createGoogleCloudKmsEd25519Signer } = require("../lib/paper-trading-simulation-receipt-kms-signer");
const { canonicalize } = require("../lib/paper-trading-simulation-receipt-verifier");

const keyVersionName = "projects/zenura-prod/locations/asia-south1/keyRings/paper-trading/cryptoKeys/simulation-receipts/cryptoKeyVersions/1";
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const payload = {
  receiptType: "PAPER_TRADING_SIMULATION",
  schemaVersion: "1.0.0",
  environment: "test",
  issuerId: "zenura-internal-paper",
  keyId: "simulation-key-01",
  algorithm: "Ed25519",
  receiptId: "receipt-001",
  simulationOnly: true,
  currency: "INR"
};
function mockKms(overrides = {}) {
  return {
    async asymmetricSign(request) {
      const data = Buffer.from(request.data);
      const signature = crypto.sign(null, data, privateKey);
      return [{
        name: request.name,
        verifiedDataCrc32c: request.dataCrc32c.value === crc32c(data),
        signature,
        signatureCrc32c: { value: crc32c(signature) },
        ...overrides
      }];
    }
  };
}
function signer(client = mockKms(), options = {}) {
  return createGoogleCloudKmsEd25519Signer({
    client, keyVersionName, issuerId: "zenura-internal-paper",
    keyId: "simulation-key-01", environment: "test", ...options
  });
}

test("signs canonical receipt bytes through the KMS adapter and verifies the returned Ed25519 signature", async () => {
  const result = await signer().signPayload(payload);
  const data = Buffer.from(canonicalize(payload), "utf8");
  const signature = Buffer.from(result.signature, "base64url");
  assert.equal(result.algorithm, "Ed25519");
  assert.equal(result.issuerId, payload.issuerId);
  assert.equal(result.keyId, payload.keyId);
  assert.equal(result.keyVersionName, keyVersionName);
  assert.equal(result.signedPayloadSha256, crypto.createHash("sha256").update(data).digest("hex"));
  assert.equal(crypto.verify(null, data, publicKey, signature), true);
  assert.equal("privateKey" in result, false);
});
test("uses raw canonical bytes and sends a correct CRC32C request checksum", async () => {
  let observed;
  const client = {
    async asymmetricSign(request) {
      observed = request;
      const signature = crypto.sign(null, request.data, privateKey);
      return [{
        name: request.name,
        verifiedDataCrc32c: request.dataCrc32c.value === crc32c(request.data),
        signature,
        signatureCrc32c: { value: crc32c(signature) }
      }];
    }
  };
  await signer(client).signPayload(payload);
  assert.deepEqual(Buffer.from(observed.data), Buffer.from(canonicalize(payload)));
  assert.equal(observed.dataCrc32c.value, crc32c(observed.data));
  assert.equal("digest" in observed, false);
});
test("fails closed on mismatched payload scope", async () => {
  await assert.rejects(() => signer().signPayload({ ...payload, environment: "production" }), /KMS_SIGNER_PAYLOAD_SCOPE_MISMATCH/);
  await assert.rejects(() => signer().signPayload({ ...payload, issuerId: "other-issuer" }), /KMS_SIGNER_PAYLOAD_SCOPE_MISMATCH/);
});
test("fails closed when KMS request integrity is not verified", async () => {
  await assert.rejects(() => signer(mockKms({ verifiedDataCrc32c: false })).signPayload(payload), /KMS_SIGNER_REQUEST_INTEGRITY_FAILED/);
});
test("fails closed when KMS response signature checksum is wrong", async () => {
  await assert.rejects(() => signer(mockKms({ signatureCrc32c: { value: 0 } })).signPayload(payload), /KMS_SIGNER_RESPONSE_INTEGRITY_FAILED/);
});
test("fails closed on malformed KMS response, KMS outage and invalid key configuration", async () => {
  await assert.rejects(() => signer({ async asymmetricSign() { throw new Error("unavailable"); } }).signPayload(payload), /KMS_SIGNER_REQUEST_FAILED/);
  assert.throws(() => signer({}, { keyVersionName: "not-a-key-version" }), /KMS_SIGNER_KEY_VERSION_NAME_INVALID/);
  assert.throws(() => createGoogleCloudKmsEd25519Signer({ keyVersionName, issuerId: "issuer", keyId: "key", environment: "test" }), /KMS_SIGNER_CLIENT_REQUIRED/);
});
