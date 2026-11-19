"use strict";

function nextReconnectDelay(attempt) {
  const current = Number.isSafeInteger(attempt) && attempt >= 0 ? attempt : 0;
  return {
    delayMs: Math.min(30000, 1000 * (2 ** Math.min(current, 5))),
    nextAttempt: Math.min(current + 1, 5)
  };
}

function jitteredReconnectDelay(delayMs, random=Math.random, jitterRatio=0.2) {\n  if (!Number.isFinite(delayMs) || delayMs < 0 || typeof random !== "function" ||\n      !Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) return null;\n  const sample = random();\n  if (!Number.isFinite(sample) || sample < 0 || sample > 1) return null;\n  const factor = 1 - jitterRatio + (2 * jitterRatio * sample);\n  return Math.max(0, Math.round(delayMs * factor));\n}\n\nfunction shouldReconnectAfterFeedError(eventName) {
  return eventName === "error";
}

function shouldRetryFeedStatus(status) {
  return Number.isInteger(status) && (
    status === 0 || status === 408 || status === 429 ||
    (status >= 500 && status <= 599)
  );
}

module.exports = {nextReconnectDelay, jitteredReconnectDelay, shouldRetryFeedStatus, shouldReconnectAfterFeedError};
