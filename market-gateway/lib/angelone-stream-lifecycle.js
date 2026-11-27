"use strict";

// Deterministic Angel One SmartAPI stream lifecycle coordinator.
// This module does not create sockets, encode provider heartbeats, hold tokens,
// or perform network I/O. A transport must send the documented heartbeat and
// apply the returned subscription snapshot after each successful reconnect.

function fail(message, code = "stream_lifecycle_invalid") {
  throw Object.assign(new Error(message), { status: 409, code });
}

function createAngelOneStreamLifecycle({
  now = () => Date.now(),
  heartbeatIntervalMs = 30000,
  maxReconnectAttempts = 5,
  baseBackoffMs = 1000,
  maxBackoffMs = 30000,
} = {}) {
  if (typeof now !== "function" ||
      !Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs <= 0 ||
      !Number.isSafeInteger(maxReconnectAttempts) || maxReconnectAttempts < 0 ||
      !Number.isSafeInteger(baseBackoffMs) || baseBackoffMs <= 0 ||
      !Number.isSafeInteger(maxBackoffMs) || maxBackoffMs < baseBackoffMs) {
    throw new TypeError("Angel One lifecycle configuration is invalid.");
  }

  let state = "disconnected";
  let generation = 0;
  let reconnectAttempts = 0;
  let nextReconnectAtMs = null;
  let lastHeartbeatSentAtMs = null;
  let lastHeartbeatAckAtMs = null;
  let subscriptions = [];

  function assertGeneration(candidate) {
    if (!Number.isSafeInteger(candidate) || candidate !== generation) {
      fail("Angel One callback belongs to a stale connection generation.", "stale_stream_generation");
    }
  }

  function setSubscriptions(tokens) {
    if (!Array.isArray(tokens) || tokens.length > 1000 ||
        tokens.some(token => typeof token !== "string" || !token.trim() || token.length > 64)) {
      fail("Angel One subscription set is invalid or exceeds the documented session cap.");
    }
    subscriptions = [...new Set(tokens)];
    return Object.freeze([...subscriptions]);
  }

  function beginConnection() {
    if (state === "closed" || state === "connected" || state === "connecting") {
      fail("Angel One connection cannot start from the current lifecycle state.");
    }
    state = "connecting";
    generation += 1;
    nextReconnectAtMs = null;
    return Object.freeze({ generation, reconnect: reconnectAttempts > 0 });
  }

  function onOpen(candidateGeneration) {
    assertGeneration(candidateGeneration);
    if (state !== "connecting") fail("Angel One open event arrived in an invalid state.");
    state = "connected";
    nextReconnectAtMs = null;
    lastHeartbeatSentAtMs = now();
    lastHeartbeatAckAtMs = null;
    return Object.freeze({
      generation,
      heartbeatIntervalMs,
      subscriptions: Object.freeze([...subscriptions]),
    });
  }

  function heartbeatDue() {
    return state === "connected" && now() - lastHeartbeatSentAtMs >= heartbeatIntervalMs;
  }

  function markHeartbeatSent(candidateGeneration) {
    assertGeneration(candidateGeneration);
    if (state !== "connected" || !heartbeatDue()) {
      fail("Angel One heartbeat is not due for the active connection.");
    }
    lastHeartbeatSentAtMs = now();
    return Object.freeze({ generation, sentAtMs: lastHeartbeatSentAtMs });
  }

  function onHeartbeatAck(candidateGeneration) {
    assertGeneration(candidateGeneration);
    if (state !== "connected") fail("Angel One heartbeat acknowledgement arrived while disconnected.");
    lastHeartbeatAckAtMs = now();
    return Object.freeze({ generation, acknowledgedAtMs: lastHeartbeatAckAtMs });
  }

  function markStable(candidateGeneration) {
    assertGeneration(candidateGeneration);
    if (state !== "connected") fail("Angel One stability marker requires an open connection.");
    reconnectAttempts = 0;
    return Object.freeze({ generation, reconnectAttempts });
  }

  function onTransportFailure(candidateGeneration) {
    assertGeneration(candidateGeneration);
    if (state !== "connected" && state !== "connecting") {
      fail("Angel One transport failure arrived in an invalid state.");
    }
    lastHeartbeatSentAtMs = null;
    lastHeartbeatAckAtMs = null;
    reconnectAttempts += 1;
    if (reconnectAttempts > maxReconnectAttempts) {
      state = "failed";
      nextReconnectAtMs = null;
      return Object.freeze({ state, reconnectAttempts, retryAtMs: null });
    }
    const delay = Math.min(baseBackoffMs * (2 ** (reconnectAttempts - 1)), maxBackoffMs);
    nextReconnectAtMs = now() + delay;
    state = "reconnect_wait";
    return Object.freeze({ state, reconnectAttempts, retryAtMs: nextReconnectAtMs, delayMs: delay });
  }

  function beginReconnect() {
    if (state !== "reconnect_wait" || now() < nextReconnectAtMs) {
      fail("Angel One reconnect is not due.");
    }
    return beginConnection();
  }

  function close() {
    state = "closed";
    generation += 1;
    nextReconnectAtMs = null;
    lastHeartbeatSentAtMs = null;
    lastHeartbeatAckAtMs = null;
    return Object.freeze({ state, generation });
  }

  return Object.freeze({
    setSubscriptions,
    beginConnection,
    onOpen,
    heartbeatDue,
    markHeartbeatSent,
    onHeartbeatAck,
    markStable,
    onTransportFailure,
    beginReconnect,
    close,
    getState() {
      return Object.freeze({
        state,
        generation,
        reconnectAttempts,
        nextReconnectAtMs,
        lastHeartbeatSentAtMs,
        lastHeartbeatAckAtMs,
        subscriptionCount: subscriptions.length,
      });
    },
  });
}

module.exports = { createAngelOneStreamLifecycle };
