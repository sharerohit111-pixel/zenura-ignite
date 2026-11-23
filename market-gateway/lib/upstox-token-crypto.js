"use strict";

const crypto = require("node:crypto");

function decodeCanonicalBase64(value, minBytes, maxBytes) {
  if (typeof value !== "string" || value.length === 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Invalid encrypted token encoding.");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length < minBytes || decoded.length > maxBytes
    || decoded.toString("base64") !== value) {
    throw new Error("Invalid encrypted token encoding.");
  }
  return decoded;
}

function decryptUpstoxToken(box, keyValue) {
  const key = decodeCanonicalBase64(keyValue, 32, 32);
  if (!box || typeof box !== "object" || Array.isArray(box) || box.v !== 1) {
    throw new Error("Invalid encrypted token envelope.");
  }
  const iv = decodeCanonicalBase64(box.iv, 12, 12);
  const tag = decodeCanonicalBase64(box.tag, 16, 16);
  const data = decodeCanonicalBase64(box.data, 1, 16384);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  const token = plaintext.toString("utf8");
  if (!token.trim() || token.length > 16384
    || /[\u0000-\u001f\u007f]/.test(token)
    || !Buffer.from(token, "utf8").equals(plaintext)) {
    throw new Error("Decrypted Upstox token is invalid.");
  }
  return token;
}


function encryptUpstoxToken(token, keyValue) {
  if (typeof token !== "string" || !token.trim() || token.length > 16384
    || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new Error("Invalid Upstox token.");
  }
  const key = decodeCanonicalBase64(keyValue, 32, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64")
  };
}

module.exports = {decryptUpstoxToken,encryptUpstoxToken};
