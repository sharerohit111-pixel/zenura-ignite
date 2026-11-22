"use strict";

const functions = require("firebase-functions/v1");
const { getAuth } = require("firebase-admin/auth");
const logger = require("firebase-functions/logger");
const { ensureSupabaseRoleClaimForNewUser } = require("./lib/supabase-role-claim-backfill");

// The environment gate keeps this trigger inert until the Supabase Firebase
// third-party Auth provider has been enabled and verified for this project.
exports.assignSupabaseRoleClaimOnUserCreate = functions.auth.user().onCreate(async user => {
  try {
    const result = await ensureSupabaseRoleClaimForNewUser({
      auth: getAuth(),
      uid: user.uid,
      enabled: process.env.SUPABASE_FIREBASE_TPA_READY === "true"
    });
    if (result.status === "role-conflict") {
      logger.warn("Supabase role claim skipped because an existing role claim conflicts.");
    }
    return null;
  } catch (error) {
    logger.error("Supabase role claim sync failed.", {
      code: error?.code || "SUPABASE_ROLE_CLAIM_SYNC_FAILED"
    });
    throw error;
  }
});
