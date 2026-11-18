"use strict";

function isUsableUpstoxTokenResponse(payload) {
  return !!payload
    && typeof payload === "object"
    && !Array.isArray(payload)
    && typeof payload.access_token === "string"
    && payload.access_token.length > 0
    && payload.access_token.length <= 16384;
}

module.exports = {isUsableUpstoxTokenResponse};
