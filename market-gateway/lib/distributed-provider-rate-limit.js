"use strict";

function createDistributedProviderRateLimiter({ serviceDb }) {
  if (!serviceDb || typeof serviceDb.rpc !== "function") {
    throw new TypeError("A server-only Supabase service client is required.");
  }

  async function consume(providerId, operation, { userId, cost = 1 } = {}) {
    if (typeof providerId !== "string" || !/^[a-z][a-z0-9_-]{1,39}$/.test(providerId) ||
        typeof operation !== "string" || !/^[a-z][a-z0-9_-]{1,39}$/.test(operation) ||
        typeof userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) ||
        !Number.isSafeInteger(cost) || cost < 1 || cost > 10000) {
      throw new TypeError("Distributed provider quota request is invalid.");
    }

    let result;
    try {
      result = await serviceDb.rpc("consume_market_data_provider_quota", {
        p_provider_id: providerId,
        p_operation: operation,
        p_user_id: userId,
        p_cost: cost,
      });
    } catch {
      throw Object.assign(new Error("Provider quota service is unavailable; request rejected."), {
        status: 503, code: "provider_quota_unavailable",
      });
    }
    if (result?.error) {
      throw Object.assign(new Error("Provider quota policy is missing or unavailable; request rejected."), {
        status: 503,
        code: result.error.code || "provider_quota_unavailable",
      });
    }

    const data = result?.data;
    if (!data || typeof data !== "object" || typeof data.allowed !== "boolean" ||
        !Number.isSafeInteger(data.retry_after_ms) || data.retry_after_ms < 0 ||
        !Number.isSafeInteger(data.provider_remaining) || data.provider_remaining < 0 ||
        !Number.isSafeInteger(data.user_remaining) || data.user_remaining < 0) {
      throw Object.assign(new Error("Provider quota service returned an invalid response; request rejected."), {
        status: 503, code: "provider_quota_invalid_response",
      });
    }

    if (!data.allowed) {
      throw Object.assign(new Error("Provider request rate limit exceeded."), {
        status: 429,
        code: "provider_rate_limited",
        retryAfterMs: data.retry_after_ms,
      });
    }
    return Object.freeze({
      remaining: Math.min(data.provider_remaining, data.user_remaining),
      providerRemaining: data.provider_remaining,
      userRemaining: data.user_remaining,
      resetAfterMs: 0,
    });
  }

  return Object.freeze({ consume });
}

module.exports = { createDistributedProviderRateLimiter };
