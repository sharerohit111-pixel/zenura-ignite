"use strict";

function nextReconnectDelay(attempt) {
  const current = Number.isSafeInteger(attempt) && attempt >= 0 ? attempt : 0;
  return {
    delayMs: Math.min(30000, 1000 * (2 ** Math.min(current, 5))),
    nextAttempt: Math.min(current + 1, 5)
  };
}

function jitteredReconnectDelay(delayMs, random=Math.random, jitterRatio=0.2) {
  if (!Number.isFinite(delayMs) || delayMs < 0 || typeof random !== "function" ||
      !Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) return null;
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample > 1) return null;
  const factor = 1 - jitterRatio + (2 * jitterRatio * sample);
  return Math.min(30000, Math.max(0, Math.round(delayMs * factor)));
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

const policy = {nextReconnectDelay, jitteredReconnectDelay, shouldRetryFeedStatus, shouldReconnectAfterFeedError};
if (typeof window !== "undefined") window.ZenuraReconnectPolicy = policy;
if (typeof module !== "undefined" && module.exports) module.exports = policy;
