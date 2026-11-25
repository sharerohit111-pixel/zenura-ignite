"use strict";

const INVALID_CREDENTIAL_CODES = new Set([
  "auth/argument-error",
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/invalid-id-token",
  "auth/user-disabled",
  "auth/user-not-found"
]);

async function authenticateFirebaseRequest(req, auth) {
  const header = req?.get?.("authorization") || "";
  if (!header.startsWith("Bearer ") || header.length <= 7) {
    throw Object.assign(new Error("Sign in required"), {status: 401});
  }
  if (!auth || typeof auth.verifyIdToken !== "function") {
    throw Object.assign(new Error("Authentication service unavailable"), {status: 503});
  }
  try {
    // Check revocation and disabled-user status, not only JWT signature/expiry.
    return await auth.verifyIdToken(header.slice(7), true);
  } catch (error) {
    const status = INVALID_CREDENTIAL_CODES.has(error?.code) ? 401 : 503;
    throw Object.assign(
      new Error(status === 401 ? "Sign in required" : "Authentication service unavailable"),
      {status}
    );
  }
}

module.exports = {authenticateFirebaseRequest};
