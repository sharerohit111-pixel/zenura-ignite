"use strict";

const { authenticateFirebaseRequest } = require("./firebase-auth");

/**
 * Authenticate with the existing Firebase verifier first, then resolve the verified
 * Firebase UID to the internal Supabase UUID. Never accept a user ID from request data.
 */
async function authenticateSupabaseRequest(req, { firebaseAuth, supabaseClient } = {}) {
  if (!supabaseClient || typeof supabaseClient.resolveFirebaseUid !== "function") {
    throw Object.assign(new Error("Supabase identity service is unavailable."), {
      status: 503,
      code: "SUPABASE_IDENTITY_UNAVAILABLE"
    });
  }

  const decoded = await authenticateFirebaseRequest(req, firebaseAuth);
  const firebaseUid = decoded?.uid;
  const supabaseUserId = await supabaseClient.resolveFirebaseUid(firebaseUid);

  return Object.freeze({ firebaseUid, supabaseUserId });
}

module.exports = { authenticateSupabaseRequest };
