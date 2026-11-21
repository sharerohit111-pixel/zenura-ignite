"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {decryptUpstoxToken} = require("../lib/upstox-token-crypto");

function encrypt(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(value), cipher.final()]);
  return {v:1,iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),data:data.toString("base64")};
}

test("decrypts a valid AES-256-GCM token envelope", () => {
  const key = crypto.randomBytes(32);
  const token = "opaque-upstox-access-token";
  assert.equal(decryptUpstoxToken(encrypt(token, key), key.toString("base64")), token);
});

test("rejects malformed key, envelope, IV, tag, and ciphertext encodings", () => {
  const key = crypto.randomBytes(32);
  const box = encrypt("opaque-token", key);
  for (const invalidKey of ["", "not-base64", Buffer.alloc(31).toString("base64")]) {
    assert.throws(() => decryptUpstoxToken(box, invalidKey));
  }
  for (const invalidBox of [null, [], {...box,v:2}, {...box,iv:"bad"}, {...box,tag:"bad"}, {...box,data:"bad"}]) {
    assert.throws(() => decryptUpstoxToken(invalidBox, key.toString("base64")));
  }
});

test("rejects tampered ciphertext and authentication tags", () => {
  const key = crypto.randomBytes(32);
  const box = encrypt("opaque-token", key);
  const changed = {...box, data:Buffer.from("tampered").toString("base64")};
  assert.throws(() => decryptUpstoxToken(changed, key.toString("base64")));
  const changedTag = {...box, tag:Buffer.alloc(16).toString("base64")};
  assert.throws(() => decryptUpstoxToken(changedTag, key.toString("base64")));
});

test("rejects authenticated empty, control-character, and invalid UTF-8 plaintext", () => {
  const key = crypto.randomBytes(32);
  for (const value of [Buffer.alloc(0), Buffer.from("\nforged", "utf8"), Buffer.from([0xff, 0xfe])]) {
    assert.throws(() => decryptUpstoxToken(encrypt(value, key), key.toString("base64")));
  }
});
