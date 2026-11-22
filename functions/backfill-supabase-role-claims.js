"use strict";

const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const {
  EXPECTED_FIREBASE_PROJECT_ID,
  backfillSupabaseRoleClaims
} = require("./lib/supabase-role-claim-backfill");

async function main() {
  const apply = process.argv.includes("--apply");
  const confirmation = process.argv.find(arg => arg.startsWith("--confirm-project="));
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (projectId !== EXPECTED_FIREBASE_PROJECT_ID) {
    throw new Error("FIREBASE_PROJECT_ID must be " + EXPECTED_FIREBASE_PROJECT_ID);
  }
  if (apply && confirmation !== "--confirm-project=" + EXPECTED_FIREBASE_PROJECT_ID) {
    throw new Error("Applying claims requires --confirm-project=" + EXPECTED_FIREBASE_PROJECT_ID);
  }
  if (apply && process.env.SUPABASE_FIREBASE_TPA_READY !== "true") {
    throw new Error("Set SUPABASE_FIREBASE_TPA_READY=true only after enabling Firebase third-party Auth in Supabase.");
  }

  const app = initializeApp({ credential: applicationDefault(), projectId });
  const auth = getAuth(app);
  const summary = await backfillSupabaseRoleClaims({
    auth,
    projectId,
    apply,
    thirdPartyAuthReady: process.env.SUPABASE_FIREBASE_TPA_READY === "true"
  });

  process.stdout.write(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    ...summary
  }) + "\n");
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write("Firebase role-claim backfill stopped. No user identifiers were logged.\n");
    process.exitCode = 1;
  });
}

module.exports = { main };
