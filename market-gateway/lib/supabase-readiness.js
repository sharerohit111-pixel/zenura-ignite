"use strict";

async function probeEndpoint(fetchImpl, url, publishableKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { apikey: publishableKey, Accept: "application/json" },
      signal: controller.signal
    });
    return response?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function checkSupabaseReadiness({
  supabaseUrl,
  publishableKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 3000
} = {}) {
  let base;
  try {
    base = new URL(String(supabaseUrl || ""));
  } catch {
    return { authApi: false, dataApi: false };
  }
  if (base.protocol !== "https:" || base.username || base.password ||
      base.search || base.hash || base.pathname !== "/" ||
      typeof publishableKey !== "string" || !publishableKey.trim() ||
      typeof fetchImpl !== "function") {
    return { authApi: false, dataApi: false };
  }

  const boundedTimeout = Number.isFinite(timeoutMs)
    ? Math.max(100, Math.min(10000, timeoutMs))
    : 3000;
  const origin = base.origin;
  const [authApi, dataApi] = await Promise.all([
    probeEndpoint(fetchImpl, origin + "/auth/v1/health", publishableKey, boundedTimeout),
    probeEndpoint(fetchImpl, origin + "/rest/v1/", publishableKey, boundedTimeout)
  ]);
  return { authApi, dataApi };
}

module.exports = { checkSupabaseReadiness };
