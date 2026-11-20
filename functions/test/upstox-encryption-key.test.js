"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {decodeUpstoxEncryptionKey} = require("../lib/upstox-encryption-key");

test("decodes a canonical base64 32-byte key", () => {
  const value = Buffer.alloc(32, 7).toString("base64");
  assert.deepEqual(decodeUpstoxEncryptionKey(value), Buffer.alloc(32, 7));
});
test("rejects wrong lengths, malformed encodings, and non-canonical base64", () => {
  for (const value of [null, "", "not-base64", Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64"), "A".repeat(44)]) {
    assert.throws(() => decodeUpstoxEncryptionKey(value), /canonical base64/);
  }
});
