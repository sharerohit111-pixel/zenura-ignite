"use strict";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RPC_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

function serviceError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

function createSupabaseRestClient({ url, serviceRoleKey, fetchImpl = globalThis.fetch } = {}) {
  let projectOrigin;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
        parsed.search || parsed.hash) {
      throw new Error("Invalid Supabase URL");
    }
    projectOrigin = parsed.origin;
  } catch {
    throw serviceError("Supabase URL must be a valid HTTPS project URL.", 503, "SUPABASE_CONFIG_INVALID");
  }

  if (typeof serviceRoleKey !== "string" || serviceRoleKey.length < 20 ||
      typeof fetchImpl !== "function") {
    throw serviceError("Supabase server credentials or fetch runtime are unavailable.", 503, "SUPABASE_CONFIG_INVALID");
  }

  // This key is server-only. Never return it, log it, or expose this client to a browser.
  const headers = Object.freeze({
    apikey: serviceRoleKey,
    Authorization: "Bearer " + serviceRoleKey,
    Accept: "application/json"
  });

  async function request(path, options) {
    let response;
    try {
      response = await fetchImpl(projectOrigin + path, options);
    } catch {
      throw serviceError("Supabase service request could not be completed.", 503, "SUPABASE_REQUEST_FAILED");
    }

    const raw = await response.text().catch(() => "");
    if (!response.ok) {
      throw serviceError(
        "Supabase service request was rejected.",
        503,
        "SUPABASE_REQUEST_REJECTED"
      );
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      throw serviceError("Supabase returned an invalid response.", 503, "SUPABASE_RESPONSE_INVALID");
    }
  }

  async function resolveFirebaseUid(firebaseUid) {
    if (typeof firebaseUid !== "string" || firebaseUid.length < 1 ||
        firebaseUid.length > 128 || firebaseUid.trim().length === 0) {
      throw serviceError("A valid Firebase user identity is required.", 401, "FIREBASE_IDENTITY_INVALID");
    }

    const query = new URLSearchParams({
      select: "supabase_user_id",
      firebase_uid: "eq." + firebaseUid
    });
    const rows = await request(
      "/rest/v1/paper_user_identity_map?" + query.toString(),
      { method: "GET", headers }
    );

    if (!Array.isArray(rows)) {
      throw serviceError("Supabase identity mapping response is invalid.", 503, "SUPABASE_IDENTITY_MAPPING_INVALID");
    }
    if (rows.length === 0) {
      throw serviceError(
        "This Firebase account has not been migrated to Supabase yet.",
        409,
        "SUPABASE_IDENTITY_NOT_MIGRATED"
      );
    }
    if (rows.length !== 1 || typeof rows[0]?.supabase_user_id !== "string" ||
        !UUID_PATTERN.test(rows[0].supabase_user_id)) {
      throw serviceError("The stored Supabase identity mapping is invalid.", 503, "SUPABASE_IDENTITY_MAPPING_INVALID");
    }
    return rows[0].supabase_user_id.toLowerCase();
  }

  async function rpc(functionName, args) {
    if (typeof functionName !== "string" || !RPC_NAME_PATTERN.test(functionName) ||
        !args || typeof args !== "object" || Array.isArray(args)) {
      throw serviceError("Supabase RPC request is invalid.", 400, "SUPABASE_RPC_INPUT_INVALID");
    }
    return request(
      "/rest/v1/rpc/" + functionName,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(args)
      }
    );
  }

  return Object.freeze({ resolveFirebaseUid, rpc });
}

module.exports = { createSupabaseRestClient };
