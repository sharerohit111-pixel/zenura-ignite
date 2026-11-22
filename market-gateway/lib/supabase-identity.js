"use strict";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function identityError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

/**
 * Resolve an already-migrated Firebase identity to its provisioned internal Supabase UUID.
 *
 * This function deliberately does not create duplicate Auth identitys or paper accounts. Provisioning
 * and data import are separate controlled migration steps; silently creating an account
 * here could grant fresh virtual capital to a legacy user or orphan their existing data.
 */
async function resolveSupabaseUserId({ supabaseAdmin, firebaseUid }) {
  if (typeof firebaseUid !== "string" || firebaseUid.length < 1 ||
      firebaseUid.length > 128 || firebaseUid.trim().length === 0) {
    throw identityError("A valid Firebase user identity is required.", 401, "FIREBASE_IDENTITY_INVALID");
  }
  if (!supabaseAdmin || typeof supabaseAdmin.from !== "function") {
    throw identityError("Supabase identity service is unavailable.", 503, "SUPABASE_IDENTITY_UNAVAILABLE");
  }

  let result;
  try {
    result = await supabaseAdmin
      .from("paper_user_identity_map")
      .select("supabase_user_id")
      .eq("firebase_uid", firebaseUid)
      .maybeSingle();
  } catch {
    throw identityError("Supabase identity lookup failed.", 503, "SUPABASE_IDENTITY_LOOKUP_FAILED");
  }

  if (result?.error) {
    throw identityError("Supabase identity lookup failed.", 503, "SUPABASE_IDENTITY_LOOKUP_FAILED");
  }
  if (!result?.data) {
    throw identityError(
      "This Firebase account has not been migrated to Supabase yet.",
      409,
      "SUPABASE_IDENTITY_NOT_MIGRATED"
    );
  }

  const supabaseUserId = result.data.supabase_user_id;
  if (typeof supabaseUserId !== "string" || !UUID_PATTERN.test(supabaseUserId)) {
    throw identityError("The stored Supabase identity mapping is invalid.", 503, "SUPABASE_IDENTITY_MAPPING_INVALID");
  }

  return supabaseUserId.toLowerCase();
}

module.exports = { resolveSupabaseUserId };
