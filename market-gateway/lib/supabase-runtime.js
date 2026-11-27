"use strict";

const { isUuid } = require("./order-idempotency");

const SERVER_RPCS = new Set([
  "initialize_paper_trading_account",
  "initialize_paper_investing_account",
  "execute_paper_investing_market_order",
  "execute_paper_market_order",
  "submit_paper_limit_order",
  "cancel_paper_limit_order",
  "submit_paper_intraday_limit_order",
  "cancel_paper_intraday_limit_order",
  "execute_paper_long_option_order",
  "execute_paper_futures_market_order",
  "submit_paper_futures_limit_order",
  "cancel_paper_futures_limit_order",
  "submit_paper_option_limit_order",
  "cancel_paper_option_limit_order"
]);

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}
function readBearerToken(request) {
  const header = request?.get?.("authorization") || request?.headers?.authorization || "";
  const match = /^Bearer ([^\s,]+)$/i.exec(header);
  if (!match) throw httpError("Sign in required", 401);
  return match[1];
}
function createSupabaseRuntime(options = {}) {
  const supabaseUrl = String(options.supabaseUrl || "").replace(/\/+$/, "");
  const publishableKey = options.publishableKey;
  const serviceRoleKey = options.serviceRoleKey;
  const createClient = options.createClient;
  let parsed;
  try { parsed = new URL(supabaseUrl); } catch { throw new TypeError("A valid Supabase URL is required"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new TypeError("Supabase URL must be an HTTPS project origin");
  }
  if (typeof publishableKey !== "string" || !publishableKey.trim()) throw new TypeError("Supabase publishable key is required");
  if (typeof serviceRoleKey !== "string" || !serviceRoleKey.trim()) throw new TypeError("Supabase service-role key is required on the server");
  if (typeof createClient !== "function") throw new TypeError("Supabase client factory is required");

  const clientOptions = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  };
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);

  async function authenticateRequest(request) {
    const token = readBearerToken(request);
    let result;
    try {
      result = await serviceClient.auth.getUser(token);
    } catch {
      throw httpError("Supabase authentication service is unavailable", 503);
    }
    const user = result?.data?.user;
    if (result?.error || !user || !isUuid(user.id)) throw httpError("Supabase session is invalid or expired", 401);
    return Object.freeze({ id: user.id, email: typeof user.email === "string" ? user.email : null, emailConfirmedAt: user.email_confirmed_at || user.confirmed_at || null });
  }

  function createUserClient(accessToken) {
    if (typeof accessToken !== "string" || !accessToken.trim()) throw httpError("A verified Supabase access token is required", 401);
    return createClient(supabaseUrl, publishableKey, {
      ...clientOptions,
      global: { headers: { Authorization: "Bearer " + accessToken } }
    });
  }

  async function callUserRpc(user, rpcName, args = {}) {
    if (!user || !isUuid(user.id)) throw httpError("A verified Supabase user is required", 401);
    if (!SERVER_RPCS.has(rpcName)) throw httpError("Paper Trading RPC is not allowlisted", 400);
    if (!args || typeof args !== "object" || Array.isArray(args)) throw httpError("RPC arguments must be an object", 400);
    if (Object.prototype.hasOwnProperty.call(args, "p_user_id")) throw httpError("User ID is assigned by the verified server session", 400);
    const result = await serviceClient.rpc(rpcName, { ...args, p_user_id: user.id });
    if (result?.error) {
      const error = httpError("Paper account operation could not be completed", 409);
      error.code = result.error.code || null;
      throw error;
    }
    return result?.data ?? null;
  }

  return Object.freeze({
    authenticateRequest,
    createUserClient,
    callUserRpc,
    // Server-only privileged client; never imported by browser modules.
    serviceDb: serviceClient,
    projectUrl: supabaseUrl
  });
}

module.exports = { SERVER_RPCS, createSupabaseRuntime, readBearerToken };
