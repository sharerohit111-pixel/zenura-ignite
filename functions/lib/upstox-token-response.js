"use strict";

function isUsableUpstoxTokenResponse(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (typeof payload.access_token !== "string"
    || payload.access_token.length === 0
    || payload.access_token.length > 16384
    || /[\u0000-\u001f\u007f]/.test(payload.access_token)) return false;
  if (payload.token_type !== undefined
    && (typeof payload.token_type !== "string"
      || payload.token_type.length === 0
      || payload.token_type.length > 64
      || !/^[A-Za-z][A-Za-z0-9._-]*$/.test(payload.token_type))) return false;
  return true;
}

module.exports = {isUsableUpstoxTokenResponse};
