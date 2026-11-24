"use strict";

class ProviderHealthRegistry {
  constructor({ failureThreshold = 3, cooldownMs = 30000, clock = () => Date.now() } = {}) {
    if (!Number.isSafeInteger(failureThreshold) || failureThreshold < 1 ||
        !Number.isSafeInteger(cooldownMs) || cooldownMs < 1 || typeof clock !== "function") {
      throw new TypeError("Provider health registry configuration is invalid.");
    }
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.clock = clock;
    this.states = new Map();
  }

  _state(providerId) {
    if (typeof providerId !== "string" || !/^[a-z][a-z0-9_-]{1,39}$/.test(providerId)) {
      throw new TypeError("Provider id is invalid.");
    }
    if (!this.states.has(providerId)) {
      this.states.set(providerId, {
        state: "closed", consecutiveFailures: 0, openedAtMs: null,
        lastSuccessAtMs: null, lastFailureAtMs: null, lastFailureCode: null,
        probeInFlight: false,
      });
    }
    return this.states.get(providerId);
  }

  isAvailable(providerId) {
    const state = this._state(providerId);
    const now = this.clock();
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("Provider health clock is invalid.");
    if (state.state === "closed") return true;
    if (state.state === "half_open") return false;
    if (now - state.openedAtMs < this.cooldownMs) return false;
    if (state.probeInFlight) return false;
    state.state = "half_open";
    state.probeInFlight = true;
    return true;
  }

  recordSuccess(providerId) {
    const state = this._state(providerId);
    const now = this.clock();
    state.state = "closed";
    state.consecutiveFailures = 0;
    state.openedAtMs = null;
    state.probeInFlight = false;
    state.lastSuccessAtMs = now;
    state.lastFailureCode = null;
    return this.snapshot(providerId);
  }

  recordFailure(providerId, code = "provider_failure") {
    const state = this._state(providerId);
    const now = this.clock();
    state.consecutiveFailures += 1;
    state.lastFailureAtMs = now;
    state.lastFailureCode = typeof code === "string" ? code.slice(0, 80) : "provider_failure";
    state.probeInFlight = false;
    if (state.state === "half_open" || state.consecutiveFailures >= this.failureThreshold) {
      state.state = "open";
      state.openedAtMs = now;
    }
    return this.snapshot(providerId);
  }

  snapshot(providerId) {
    const state = this._state(providerId);
    return Object.freeze({
      providerId,
      state: state.state,
      consecutiveFailures: state.consecutiveFailures,
      openedAtMs: state.openedAtMs,
      lastSuccessAtMs: state.lastSuccessAtMs,
      lastFailureAtMs: state.lastFailureAtMs,
      lastFailureCode: state.lastFailureCode,
    });
  }
}

module.exports = { ProviderHealthRegistry };
