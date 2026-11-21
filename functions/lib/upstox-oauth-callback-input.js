"use strict";

function isUsableUpstoxOAuthCallback(code, state) {
  return typeof code === "string"
    && code.length > 0
    && code.length <= 4096
    && !/[\u0000-\u001f\u007f]/.test(code)
    && typeof state === "string"
    && /^[a-f0-9]{64}$/.test(state);
}

module.exports = {isUsableUpstoxOAuthCallback};
