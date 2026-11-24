"use strict";

class ProviderRateLimitPolicy {
  constructor({ limits, clock = () => Date.now() }) {
    if (!limits || typeof limits !== "object" || Array.isArray(limits) || typeof clock !== "function") {
      throw new TypeError("Provider rate-limit configuration is invalid.");
    }
    this.limits = new Map();
    for (const [key, value] of Object.entries(limits)) {
      if (!/^[a-z][a-z0-9_-]{1,39}:[a-z][a-z0-9_-]{1,39}$/.test(key) ||
          !Number.isSafeInteger(value.capacity) || value.capacity < 1 ||
          !Number.isSafeInteger(value.windowMs) || value.windowMs < 1) {
        throw new TypeError("Provider rate-limit entries require provider:operation, capacity and windowMs.");
      }
      this.limits.set(key, Object.freeze({ capacity: value.capacity, windowMs: value.windowMs }));
    }
    this.clock = clock;
    this.windows = new Map();
  }

  consume(providerId, operation, { userId, cost = 1 } = {}) {
    if (typeof providerId !== "string" || typeof operation !== "string" ||
        typeof userId !== "string" || !userId || !Number.isSafeInteger(cost) || cost < 1) {
      throw new TypeError("Provider rate-limit request is invalid.");
    }
    const key = providerId + ":" + operation;
    const limit = this.limits.get(key);
    if (!limit) throw Object.assign(new Error("No rate-limit policy is configured for this provider operation."), {
      status: 503, code: "provider_rate_limit_unconfigured",
    });
    const now = this.clock();
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("Rate-limit clock is invalid.");
    const bucketKey = key + ":" + userId;
    let bucket = this.windows.get(bucketKey);
    if (!bucket || now - bucket.startedAtMs >= limit.windowMs || now < bucket.startedAtMs) {
      bucket = { startedAtMs: now, used: 0 };
      this.windows.set(bucketKey, bucket);
    }
    if (bucket.used + cost > limit.capacity) {
      const retryAfterMs = Math.max(1, limit.windowMs - (now - bucket.startedAtMs));
      throw Object.assign(new Error("Provider request rate limit exceeded."), {
        status: 429, code: "provider_rate_limited", retryAfterMs,
      });
    }
    bucket.used += cost;
    return Object.freeze({ remaining: limit.capacity - bucket.used, resetAtMs: bucket.startedAtMs + limit.windowMs });
  }
}

module.exports = { ProviderRateLimitPolicy };
