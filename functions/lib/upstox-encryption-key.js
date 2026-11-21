"use strict";

function decodeUpstoxEncryptionKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error("UPSTOX_TOKEN_ENCRYPTION_KEY must be canonical base64 for a 32-byte key.");
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) {
    throw new Error("UPSTOX_TOKEN_ENCRYPTION_KEY must be canonical base64 for a 32-byte key.");
  }
  return key;
}

module.exports = {decodeUpstoxEncryptionKey};
