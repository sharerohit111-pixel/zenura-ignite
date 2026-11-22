"use strict";

const EXPECTED_FIREBASE_PROJECT_ID = "zenura-ignite-technologies";

function validateProjectId(projectId) {
  if (projectId !== EXPECTED_FIREBASE_PROJECT_ID) {
    throw Object.assign(new Error("Firebase project ID does not match the approved project."), {
      code: "FIREBASE_PROJECT_MISMATCH"
    });
  }
}

function claimsForUser(customClaims) {
  const claims = customClaims == null ? {} : customClaims;
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    throw Object.assign(new Error("Firebase custom claims are malformed."), {
      code: "FIREBASE_CUSTOM_CLAIMS_INVALID"
    });
  }

  if (claims.role === "authenticated") return { state: "already-configured" };
  if (claims.role != null) return { state: "role-conflict" };
  return { state: "missing", nextClaims: { ...claims, role: "authenticated" } };
}

async function backfillSupabaseRoleClaims({
  auth,
  projectId,
  apply = false,
  thirdPartyAuthReady = false,
  pageSize = 500
}) {
  validateProjectId(projectId);
  if (!auth || typeof auth.listUsers !== "function" ||
      (apply && typeof auth.setCustomUserClaims !== "function")) {
    throw Object.assign(new Error("Firebase Admin Auth service is unavailable."), {
      code: "FIREBASE_ADMIN_AUTH_UNAVAILABLE"
    });
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw Object.assign(new Error("Firebase user page size is invalid."), {
      code: "FIREBASE_PAGE_SIZE_INVALID"
    });
  }
  if (apply && thirdPartyAuthReady !== true) {
    throw Object.assign(new Error("Enable the Firebase third-party Auth integration before applying role claims."), {
      code: "SUPABASE_THIRD_PARTY_AUTH_NOT_READY"
    });
  }

  const summary = {
    projectId,
    scanned: 0,
    alreadyConfigured: 0,
    planned: 0,
    updated: 0,
    roleConflicts: 0
  };
  const seenPageTokens = new Set();
  let pageToken;

  do {
    const page = await auth.listUsers(pageSize, pageToken);
    if (!page || !Array.isArray(page.users)) {
      throw Object.assign(new Error("Firebase Admin returned an invalid user page."), {
        code: "FIREBASE_USER_PAGE_INVALID"
      });
    }

    for (const user of page.users) {
      if (!user || typeof user.uid !== "string" || user.uid.length < 1) {
        throw Object.assign(new Error("Firebase Admin returned a user without a valid UID."), {
          code: "FIREBASE_USER_UID_INVALID"
        });
      }
      summary.scanned += 1;
      const decision = claimsForUser(user.customClaims);
      if (decision.state === "already-configured") {
        summary.alreadyConfigured += 1;
      } else if (decision.state === "role-conflict") {
        summary.roleConflicts += 1;
      } else if (apply) {
        await auth.setCustomUserClaims(user.uid, decision.nextClaims);
        summary.updated += 1;
      } else {
        summary.planned += 1;
      }
    }

    pageToken = page.pageToken || undefined;
    if (pageToken) {
      if (seenPageTokens.has(pageToken)) {
        throw Object.assign(new Error("Firebase Admin repeated a pagination token."), {
          code: "FIREBASE_PAGINATION_LOOP"
        });
      }
      seenPageTokens.add(pageToken);
    }
  } while (pageToken);

  return summary;
}

async function ensureSupabaseRoleClaimForNewUser({ auth, uid, enabled = false }) {
  if (enabled !== true) return { status: "disabled" };
  if (!auth || typeof auth.getUser !== "function" ||
      typeof auth.setCustomUserClaims !== "function" ||
      typeof uid !== "string" || uid.length < 1) {
    throw Object.assign(new Error("Firebase Auth claim-sync dependencies are invalid."), {
      code: "FIREBASE_ROLE_CLAIM_SYNC_INVALID"
    });
  }

  const user = await auth.getUser(uid);
  const decision = claimsForUser(user?.customClaims);
  if (decision.state === "already-configured") return { status: "already-configured" };
  if (decision.state === "role-conflict") return { status: "role-conflict" };

  await auth.setCustomUserClaims(uid, decision.nextClaims);
  return { status: "updated" };
}

module.exports = {
  EXPECTED_FIREBASE_PROJECT_ID,
  backfillSupabaseRoleClaims,
  ensureSupabaseRoleClaimForNewUser
};
