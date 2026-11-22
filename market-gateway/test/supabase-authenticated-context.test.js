"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { authenticateSupabaseRequest } = require("../lib/supabase-authenticated-context");

test("verifies Firebase first and resolves only the token UID, never a body UID", async () => {
  const calls = [];
  const req = {
    body: { uid: "attacker-controlled-uid", firebaseUid: "spoofed" },
    get(name) {
      assert.equal(name, "authorization");
      return "Bearer verified-token";
    }
  };
  const context = await authenticateSupabaseRequest(req, {
    firebaseAuth: {
      async verifyIdToken(token, checkRevoked) {
        calls.push(["verifyIdToken", token, checkRevoked]);
        return { uid: "firebase-uid-from-verified-token" };
      }
    },
    supabaseClient: {
      async resolveFirebaseUid(uid) {
        calls.push(["resolveFirebaseUid", uid]);
        return "a1b2c3d4-e5f6-4789-abcd-0123456789ab";
      }
    }
  });

  assert.deepEqual(context, {
    firebaseUid: "firebase-uid-from-verified-token",
    supabaseUserId: "a1b2c3d4-e5f6-4789-abcd-0123456789ab"
  });
  assert.deepEqual(calls, [
    ["verifyIdToken", "verified-token", true],
    ["resolveFirebaseUid", "firebase-uid-from-verified-token"]
  ]);
});

test("does not query Supabase when Firebase authentication fails", async () => {
  let mappingCalled = false;
  const req = { get: () => "" };
  await assert.rejects(
    authenticateSupabaseRequest(req, {
      firebaseAuth: { verifyIdToken: async () => ({ uid: "should-not-be-used" }) },
      supabaseClient: { resolveFirebaseUid: async () => { mappingCalled = true; return "a1b2c3d4-e5f6-4789-abcd-0123456789ab"; } }
    }),
    error => error.status === 401
  );
  assert.equal(mappingCalled, false);
});

test("fails closed for a Firebase token without a UID", async () => {
  let mappingCalled = false;
  const req = { get: () => "Bearer valid-token" };
  await assert.rejects(
    authenticateSupabaseRequest(req, {
      firebaseAuth: { verifyIdToken: async () => ({}) },
      supabaseClient: { resolveFirebaseUid: async () => { mappingCalled = true; return "a1b2c3d4-e5f6-4789-abcd-0123456789ab"; } }
    }),
    error => error.status === 401 && error.code === "FIREBASE_IDENTITY_INVALID"
  );
  assert.equal(mappingCalled, false);
});

test("propagates an unmigrated-user rejection without fallback initialization", async () => {
  let initialized = false;
  const req = { get: () => "Bearer valid-token" };
  await assert.rejects(
    authenticateSupabaseRequest(req, {
      firebaseAuth: { verifyIdToken: async () => ({ uid: "legacy-user" }) },
      supabaseClient: {
        async resolveFirebaseUid() {
          throw Object.assign(new Error("not migrated"), {
            status: 409,
            code: "SUPABASE_IDENTITY_NOT_MIGRATED"
          });
        },
        async initializeNewAccount() { initialized = true; }
      }
    }),
    error => error.status === 409 && error.code === "SUPABASE_IDENTITY_NOT_MIGRATED"
  );
  assert.equal(initialized, false);
});

test("rejects a missing Supabase identity client", async () => {
  const req = { get: () => "Bearer valid-token" };
  await assert.rejects(
    authenticateSupabaseRequest(req, {
      firebaseAuth: { verifyIdToken: async () => ({ uid: "user" }) }
    }),
    error => error.status === 503 && error.code === "SUPABASE_IDENTITY_UNAVAILABLE"
  );
});
