"use strict";

function nextReconnectDelay(attempt) {
  const current = Number.isSafeInteger(attempt) && attempt >= 0 ? attempt : 0;
  return {
    delayMs: Math.min(30000, 1000 * (2 ** Math.min(current, 5))),
    nextAttempt: Math.min(current + 1, 5)
  };
}

function shouldReconnectAfterFeedError(eventName) {
  return eventName === "error";
}

function shouldRetryFeedStatus(status) {
  return Number.isInteger(status) && (
    status === 0 || status === 408 || status === 429 ||
    (status >= 500 && status <= 599)
  );
}

module.exports = {nextReconnectDelay, shouldRetryFeedStatus, shouldReconnectAfterFeedError};
