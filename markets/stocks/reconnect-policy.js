"use strict";

function nextReconnectDelay(attempt) {
  const current = Number.isSafeInteger(attempt) && attempt >= 0 ? attempt : 0;
  return {
    delayMs: Math.min(30000, 1000 * (2 ** Math.min(current, 5))),
    nextAttempt: Math.min(current + 1, 5)
  };
}

module.exports = {nextReconnectDelay};
